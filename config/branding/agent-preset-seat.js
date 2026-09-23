// Inserted into the pinned DSH client module by apply-dsh-branding.py.
function AgentPresetSeat({ load, select, introduced, useAgentPresetSeat, t }) {
  const state = useAgentPresetSeat((snapshot) => snapshot);
  const [toast, setToast] = react.useState(null);
  const toastSeq = react.useRef(0);
  const selecting = react.useRef(false);
  const [pending, setPending] = react.useState(false);
  const switcher = react.useRef(null);
  const [indicator, setIndicator] = react.useState(null);
  react.useEffect(() => { load(); }, [load]);
  react.useEffect(() => {
    if (state.introduce && state.current !== "") introduced();
  }, [state.introduce, state.current, introduced]);

  // Product entry points only. The settings roster intentionally stays complete.
  const productPresets = ["baichuan-gynecology", "baichuan-pediatrics", "baichuan-office"];
  const presetIcon = (id) => {
    const paths = {
      "baichuan-gynecology": ["M12 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z", "M12 14v7M8.5 18h7"],
      "baichuan-pediatrics": ["M9 4.6a8 8 0 0 0-4.7 5.6 2 2 0 0 0 0 3.8 8 8 0 0 0 15.4 0 2 2 0 0 0 0-3.8A8 8 0 0 0 15 4.6", "M9 4.6C9 1.5 15 1.5 15 4.6c0 2-3 2.4-3 0", "M8.5 10.5h.01M15.5 10.5h.01M9 15a4.2 4.2 0 0 0 6 0"],
      "baichuan-office": ["M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M5 7h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z", "M3 11a22 22 0 0 0 18 0M12 11v4"]
    };
    return react_jsx_runtime.jsx("svg", {
      className: "bc-preset-icon", width: 17, height: 17, viewBox: "0 0 24 24",
      fill: "none", stroke: "currentColor", strokeWidth: 1.8,
      strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false",
      children: paths[id].map((d, index) => react_jsx_runtime.jsx("path", { d }, index))
    });
  };
  const options = productPresets.map(id => state.options.find(option => option.id === id)).filter(Boolean);
  const optionLayout = options.map((option) => `${option.id}:${presetDisplayText(option, t).name}`).join("|");
  react.useLayoutEffect(() => {
    const bar = switcher.current;
    if (!bar) return;
    const buttons = Array.from(bar.querySelectorAll("button[data-preset-id]"));
    const measure = () => {
      const selected = buttons.find((button) => button.dataset.presetId === state.current);
      if (!selected) { setIndicator(null); return; }
      const next = { x: selected.offsetLeft, y: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight };
      setIndicator((previous) => previous && Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    buttons.forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [state.current, optionLayout]);
  const pick = async (option) => {
    if (selecting.current || state.busy || option.id === state.current) return;
    selecting.current = true;
    setPending(true);
    try {
      const refusal = await select(option.id);
      if (refusal !== undefined) {
        setToast({ seq: ++toastSeq.current, text: t("switchRefused", {
          name: presetDisplayText(option, t).name, reason: refusal
        }) });
      }
    } catch {
      setToast({ seq: ++toastSeq.current, text: t("error") });
    } finally {
      selecting.current = false;
      setPending(false);
    }
  };

  if (options.length === 0) return state.error
    ? react_jsx_runtime.jsx("button", {
        type: "button", className: "bc-preset-retry", onClick: load,
        children: `${t("error")} ${t("retry")}`
      })
    : null;

  return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
    react_jsx_runtime.jsxs("div", {
      ref: switcher,
      className: "bc-preset-switcher", role: "group", "aria-label": t("nav"),
      "aria-busy": state.busy || pending,
      "data-indicator-ready": indicator !== null ? "" : undefined,
      children: [indicator !== null && react_jsx_runtime.jsx("span", {
        className: "bc-preset-indicator", "aria-hidden": true,
        style: {
          transform: `translate(${indicator.x}px, ${indicator.y}px)`,
          width: indicator.width, height: indicator.height
        }
      }), ...options.map((option) => {
        const text = presetDisplayText(option, t);
        return react_jsx_runtime.jsxs("button", {
          type: "button", className: "bc-preset-option",
          "aria-pressed": option.id === state.current,
          "data-preset-id": option.id,
          disabled: state.busy || pending,
          title: text.description ?? text.name,
          onClick: () => { void pick(option); },
          onKeyDown: (event) => {
            const buttons = Array.from(event.currentTarget.parentElement.querySelectorAll("button:not(:disabled)"));
            const current = buttons.indexOf(event.currentTarget);
            let next;
            if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
            if (event.key === "ArrowLeft") next = (current + buttons.length - 1) % buttons.length;
            if (event.key === "Home") next = 0;
            if (event.key === "End") next = buttons.length - 1;
            if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
          },
          children: [
            presetIcon(option.id),
            react_jsx_runtime.jsx("span", { children: text.name })
          ]
        }, option.id);
      })]
    }),
    toast !== null && react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Toast, {
      text: toast.text,
      icon: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, {}),
      holdMs: REFUSAL_HOLD_MS,
      anchor: document.querySelector("[data-composer-card]"),
      onDone: () => setToast(null)
    }, toast.seq)
  ] });
}
