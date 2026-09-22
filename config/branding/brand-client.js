// Project-local replacement for the published DSH brand occupants.
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-brand-official",
  factory: (require) => {
    const { jsx } = require("react/jsx-runtime");
    const productName = "百川妇幼专科Agent";
    function BrandMark({ size = 24, className }) {
      return jsx("img", {
        src: "/branding/baichuan-medical-logo.png?v=2",
        alt: productName,
        width: size,
        height: size,
        className,
        draggable: false,
        style: { display: "block", width: size, height: size, objectFit: "contain", flexShrink: 0 }
      });
    }
    function BrandName() {
      return jsx("span", {
        title: productName,
        style: { fontSize: "13.5px", fontWeight: 650, letterSpacing: "-0.3px", whiteSpace: "nowrap", lineHeight: "24px" },
        children: productName
      });
    }
    function apply(ctx) {
      ctx.slots.inject("sidebar.brand.mark", () =>
        ctx.slots.inject("sidebar.brand.name", function* () {
          yield ctx.slots.register({ name: "sidebar.brand.mark" }, BrandMark);
          yield ctx.slots.register({ name: "sidebar.brand.name" }, BrandName);
        })
      );
      ctx.slots.inject("conversation.hero.brand.mark", () =>
        ctx.slots.register({ name: "conversation.hero.brand.mark" }, BrandMark)
      );
    }
    return { apply, inject: ["slots"] };
  }
});
