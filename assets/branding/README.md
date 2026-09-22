# 百川妇幼专科Agent Logo

- `baichuan-medical-logo-original.png`：用户提供的 256 × 256 原图。
- `baichuan-medical-logo-hd.png`：图像生成工具增强后的 1254 × 1254 PNG。

工具：`image_gen.imagegen`，使用原图作为编辑参考。提示词要求保持橙色圆角方块、白色头部/对话轮廓、黑色“医”字和橙色圆点的构图，修复边缘并提高分辨率，不添加文字。生成属于视觉重建，并非原始品牌矢量文件。

第二版修正提示：橙色背景和圆点必须完全不透明，使用实色填充；白色轮廓和黑色字形也不透明，圆角之外为白色，不抠图、不保留透明像素。继续使用内置图像编辑工具，以原图为参考重新增强。资源 URL 已更新为 `v=2`，避免沿用旧图缓存。

运行 `python3 scripts/apply-dsh-branding.py` 可将品牌覆盖应用到项目内固定版本的 DSH。`python3 scripts/dsh-local.py start` 也会自动应用覆盖。覆盖包括侧栏、欢迎页、文档标题、favicon 和 Web App manifest；模型供应商名称保持其实际来源。
