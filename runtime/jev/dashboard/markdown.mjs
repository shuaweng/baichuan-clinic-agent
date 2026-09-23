// Share renderer settings between the browser and local verification.
export function createMarkdownRenderer(markdownit) {
  const md = markdownit({html:false, breaks:true, linkify:false, typographer:false});
  const linkOpen = md.renderer.rules.link_open ?? ((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
  md.renderer.rules.link_open = (tokens,index,options,env,self) => {
    tokens[index].attrSet('target','_blank');
    tokens[index].attrSet('rel','noopener noreferrer');
    return linkOpen(tokens,index,options,env,self);
  };
  // Conversation images must not trigger automatic requests to remote hosts.
  md.renderer.rules.image = (tokens,index) => `<span class="markdown-image">[图片：${md.utils.escapeHtml(tokens[index].content || '未提供说明')}]</span>`;
  return text => md.render(String(text ?? ''));
}
