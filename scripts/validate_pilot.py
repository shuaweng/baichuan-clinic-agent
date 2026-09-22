"""Check the pilot data and critical evaluation guards, without network calls."""
import copy
import json
from collections import Counter

from prepare_jev import ROOT, build_payload, read_json, read_records


def check(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    records = read_records(ROOT / "data/query-pilot-100.jsonl")
    authoring = read_records(ROOT / "data/query-pilot-100.authoring.jsonl")
    profile = read_json(ROOT / "config/product-profile.v0.1.json")
    config = read_json(ROOT / "config/jev-questions.v0.1.json")
    check(len(records) == 100, "Expected 100 queries")
    check([row["sample_id"] for row in records] == [f"Q{i:03d}" for i in range(1, 101)], "Missing, duplicate or out-of-order sample IDs")
    check(len({row["current"]["query"] for row in records}) == 100, "Duplicate query text")
    check(len({row["conversation_id"] for row in records}) == 100, "Pilot scenarios must have independent conversation IDs")
    check([row["sample_id"] for row in authoring] == [row["sample_id"] for row in records], "Authoring records do not match")
    groups = Counter(row["sampling_bucket"] for row in authoring)
    check(len(groups) == 10 and set(groups.values()) == {10}, "Expected ten groups of ten")
    for row in authoring:
        check(row["not_gold_labels"] and row["never_include_in_jev_state"], "Authoring metadata needs explicit restrictions")

    rejected_qa = 0
    for record in records:
        sample = record["sample_id"]
        check(record["source"]["kind"] == "synthetic" and record["source"]["is_real_baixiaoyi_traffic"] is False, sample + ": missing synthetic disclosure")
        check(record["current"]["answer"] is None, sample + ": current answers are not part of this stage")
        check(record["review"]["status"] == "pending_human_review" and record["review"]["gold_labels"] is None, sample + ": false review claim")
        check(record["review"]["clinical_accuracy"] == "not_evaluated", sample + ": false clinical claim")
        check(record["execution"] == {"observation_status": "not_collected", "events": []}, sample + ": unexpected execution evidence")
        history = record["history"]
        check(len(history) <= 5, sample + ": too many history rounds in this pilot")
        for i, turn in enumerate(history, 1):
            check(turn["turn_id"] == f"{sample}-H{i}" and bool(turn["user"]) and bool(turn["assistant"]), sample + ": broken history order or text")
            check(turn["provenance"] == "synthetic_mock_context", sample + ": undisclosed mock history")
        check(record["current"]["turn_id"] == f"{sample}-T{len(history) + 1}", sample + ": current turn overlaps history")
        for item in record["attachments"]:
            check(item["provenance"] == "synthetic_fixture", sample + ": undisclosed synthetic attachment")
            check((item["status"] == "referenced_but_unavailable" and item["text"] is None) or (item["status"] == "synthetic_text_available" and isinstance(item["text"], str) and item["text"]), sample + ": invalid attachment state")
        payload = build_payload(record, profile, config)
        check(len(payload["questions"]) == 12, sample + ": expected 12 query questions")
        check("answer" not in payload["state"]["current"] and "execution" not in payload["state"], sample + ": QA evidence leaked into query-only state")
        check(not (set(payload["questions"]) & set(config["qa_questions"])), sample + ": QA questions used without answer")
        for question in payload["questions"].values():
            check(question["type"] in {"choice", "noul"} and question["instructions"]["question"], "Malformed question")
            if question["type"] == "choice":
                check(2 <= len(question["criteria"]) <= 255, "Malformed choice criteria")
        try:
            build_payload(record, profile, config, mode="qa")
        except ValueError as error:
            check("current.answer" in str(error), "QA rejected for unrelated reason")
            rejected_qa += 1
        else:
            raise ValueError(sample + ": QA must reject null answer")

    # An injected private label must not survive the allowlisted record projection.
    private = copy.deepcopy(records[43])
    sentinel = "PRIVATE_GOLD_LABEL_SENTINEL"
    private["gold_labels"] = sentinel
    private["authoring"] = {"sampling_bucket": sentinel}
    private["review"]["gold_labels"] = sentinel
    private["source"]["generator"] = sentinel
    private["history"][0]["authoring_note"] = sentinel
    private["current"]["expected_outcome"] = sentinel
    check(sentinel not in json.dumps(build_payload(private, profile, config)), "Private authoring data leaked")

    # Answer variants may enter QA only after an answer exists.
    private["current"]["answer"] = "明白，你指的是早上八点。我还没有创建提醒。"
    qa = build_payload(private, profile, config, mode="qa")
    check(len(qa["questions"]) == 17 and "execution" in qa["state"], "Valid QA fixture failed")
    check(sentinel not in json.dumps(qa), "Private labels leaked in QA mode")
    for empty_answer in ("", "   "):
        private["current"]["answer"] = empty_answer
        try:
            build_payload(private, profile, config, mode="qa")
        except ValueError:
            pass
        else:
            raise ValueError("Blank answer accepted")

    # Window selection is chronological, excludes current and handles zero.
    private["history"] = [{"turn_id": f"H{i}", "user": f"用户{i}", "assistant": f"回复{i}"} for i in range(1, 8)]
    windowed = build_payload(private, profile, config)["state"]
    check([turn["turn_id"] for turn in windowed["history"]] == ["H3", "H4", "H5", "H6", "H7"], "Window does not select last five rounds")
    check(windowed["history_info"]["omitted_by_window"] == 2, "Missing window truncation disclosure")
    check(build_payload(private, profile, config, history_window=0)["state"]["history"] == [], "Zero-window ablation failed")

    print(f"PASS: {len(records)} unique synthetic queries; 10 groups × 10; history and attachments valid.")
    print(f"PASS: {rejected_qa} null answers blocked from QA; blank answers blocked; valid QA fixture accepted.")
    print("PASS: query/QA separation, private-label isolation, chronological 5-round and 0-round windows.")
    print("No API calls, human labels, clinical validation or model accuracy measurements performed.")


if __name__ == "__main__":
    main()
