"""Assemble a local TypeSafe request; never sends it or reads credentials."""
import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_records(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def pick(value, fields):
    return {key: copy.deepcopy(value[key]) for key in fields if key in value}


def build_payload(record, profile, config, mode="query", history_window=5):
    if mode not in {"query", "qa"}:
        raise ValueError("mode must be query or qa")
    if not isinstance(history_window, int) or history_window < 0:
        raise ValueError("history_window must be a nonnegative integer")
    current = record["current"]
    if mode == "qa" and (not isinstance(current.get("answer"), str) or not current["answer"].strip()):
        raise ValueError("QA 模式需要非空 current.answer；当前只有 Query，不能评回复好坏。")
    if not isinstance(current.get("query"), str) or not current["query"].strip():
        raise ValueError("current.query must be nonempty text")

    history = record.get("history", [])
    selected = history[-history_window:] if history_window else []
    # Product profile is a separately maintained trusted configuration. Record
    # metadata, authoring notes and gold labels never enter the evaluator state.
    state = {
        "product_profile": copy.deepcopy(profile),
        "surface": record.get("surface", "unspecified"),
        "history": [pick(turn, ("turn_id", "user", "assistant")) for turn in selected],
        "history_info": {
            "included_rounds": len(selected),
            "available_in_record": len(history),
            "omitted_by_window": max(0, len(history) - len(selected)),
            "earlier_history_status": record.get("history_info", {}).get("earlier_history_status", "unknown"),
        },
        "current": pick(current, ("turn_id", "query")),
        "attachments": [pick(item, ("attachment_id", "status", "text")) for item in record.get("attachments", [])],
        "relevant_memory": [pick(item, ("fact_id", "text", "source_turn_id", "observed_at")) for item in record.get("relevant_memory", [])],
        "time_context": pick(record.get("time_context", {"observed_at": None, "timezone": None, "status": "not_supplied"}), ("observed_at", "timezone", "status")),
    }
    questions = copy.deepcopy(config["query_questions"])
    for question_id, instructions in config["multi_intent_probes"].items():
        if question_id in questions:
            raise ValueError("Duplicate question ID: " + question_id)
        questions[question_id] = {"type": "noul", "instructions": instructions}
    if mode == "qa":
        state["current"]["answer"] = current["answer"]
        execution = record.get("execution", {})
        state["execution"] = {
            "observation_status": execution.get("observation_status", "not_collected"),
            "events": [pick(event, ("event_id", "turn_id", "action", "arguments", "status", "result", "observed_at")) for event in execution.get("events", [])],
        }
        for question_id, question in config["qa_questions"].items():
            if question_id in questions:
                raise ValueError("Duplicate question ID: " + question_id)
            questions[question_id] = copy.deepcopy(question)
    for question in questions.values():
        question["instructions"] = {"shared_rules": config["shared_instruction"], "question": question["instructions"]}
    return {"model": config["model"], "state": state, "questions": questions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", required=True, help="Example: Q044")
    parser.add_argument("--mode", choices=("query", "qa"), default="query")
    parser.add_argument("--input", type=Path, default=ROOT / "data/query-pilot-100.jsonl")
    parser.add_argument("--history-window", type=int, default=5)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    matches = [record for record in read_records(args.input) if record["sample_id"] == args.sample]
    if len(matches) != 1:
        parser.error("Expected exactly one matching sample; found " + str(len(matches)))
    try:
        payload = build_payload(matches[0], read_json(ROOT / "config/product-profile.v0.1.json"), read_json(ROOT / "config/jev-questions.v0.1.json"), args.mode, args.history_window)
    except ValueError as error:
        parser.error(str(error))
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered, encoding="utf-8")
        print("Wrote local request:", args.out)
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
