// Pinned Markdown renderer adapter. Preserve sanitized links and rendered AST nodes.
function bcCitationNumber(children) {
  const values=I.Children.toArray(children);
  if(!values.length||values.some(v=>typeof v!=='string'&&typeof v!=='number'))return null;
  return values.join('').trim().match(/^\[?(\d{1,3})\]?$/)?.[1]??null;
}
function bcCitationText(node) {
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(!I.isValidElement(node))return '';
  return I.Children.toArray(node.props.children).map(bcCitationText).join('');
}
function bcCitationIsLink(node) {
  return I.isValidElement(node) && (node.type === 'a' ||
    (typeof bcCitationLinkComponent !== 'undefined' && node.type === bcCitationLinkComponent));
}
function bcCitationHasLink(node) {
  if(!I.isValidElement(node))return false;
  if(bcCitationIsLink(node))return true;
  return I.Children.toArray(node.props.children).some(bcCitationHasLink);
}
function bcCitationHeading(node) {
  if(!I.isValidElement(node)||!['p','h1','h2','h3','h4','h5','h6'].includes(node.type))return false;
  return /^(全部引用|引用|参考资料|参考文献|参考来源|资料来源|参考依据|References|Sources)\s*[:：]?$/i.test(bcCitationText(node).trim());
}
function bcCitationLinks(node) {
  if(!I.isValidElement(node))return [];
  if(bcCitationIsLink(node))return [node];
  return I.Children.toArray(node.props.children).flatMap(bcCitationLinks);
}
function bcReferenceItem(node,key) {
  const links=bcCitationLinks(node);
  const source=typeof bcCitationSources==='undefined'?null:links.map(link=>bcCitationSources[link.props.href]).find(Boolean);
  if(!source)return d.jsx('li',{className:'bc-reference-item bc-reference-unstructured',children:node.props.children},key);
  const original=bcCitationText(node);
  // Only bibliographic metadata from the actual local source registry is used.
  // An explicitly different historical version must keep its original citation.
  const version=original.match(/版本\s*([\d][\d./ -]*)/)?.[1]?.trim();
  if(version&&!source.version.includes(version))return d.jsx('li',{className:'bc-reference-item bc-reference-unstructured',children:node.props.children},key);
  const locator=original.match(/(?:locator\s*[:：]|原文定位\s*[:：]|章节\s*[:：])\s*([\s\S]*?)(?=；人群|;\s*population|https?:\/\/|（本库快照|$)/i)?.[1]?.replace(/[；;，,\s]+$/,'');
  const type=source.source_type.includes('decision-support')?'决策支持表':source.source_type.includes('web guidance')?'机构资料':null;
  return d.jsxs('li',{className:'bc-reference-item',children:[
    d.jsxs('div',{className:'bc-reference-heading',children:[
      type&&d.jsx('span',{className:'bc-reference-kind',children:type}),
      d.jsx('a',{className:'bc-reference-title',href:source.url,target:'_blank',rel:'noopener noreferrer',children:source.title_zh||source.title})]}),
    source.title_zh&&d.jsx('div',{className:'bc-reference-meta',children:`[原] ${source.title}`}),
    d.jsx('div',{className:'bc-reference-meta',children:[source.version,source.publisher].filter(Boolean).join('　')}),
    locator&&d.jsx('div',{className:'bc-reference-meta',children:`原文定位：${locator}`}),
    source.population&&d.jsx('div',{className:'bc-reference-meta',children:`适用范围：${source.population}`})
  ]},key);
}
function bcReferenceList(body) {
  let ordinal=0;
  return body.filter(I.isValidElement).map((node,index)=>{
    if(['ol','ul'].includes(node.type)) {
      const start=node.props.start??ordinal+1;
      const rows=I.Children.toArray(node.props.children).filter(v=>I.isValidElement(v)&&v.type==='li');
      ordinal=start+rows.length-1;
      return d.jsx('ol',{className:'bc-reference-list',start,children:rows.map((row,i)=>bcReferenceItem(row,`${index}-${i}`))},node.key??index);
    }
    return d.jsx('ol',{className:'bc-reference-list',start:++ordinal,children:bcReferenceItem(node,index)},node.key??index);
  });
}
// Resolve only explicit bibliography numbers in this answer, never guessed sources.
function bcCitationTargets(items) {
  const targets=new Map();
  const add=(number,node)=>{
    const urls=[...new Set(bcCitationLinks(node).map(link=>link.props.href).filter(url=>{
      try{return ['http:','https:'].includes(new URL(url).protocol);}catch{return false;}
    }))];
    if(urls.length!==1)return;
    const key=String(number),url=urls[0];
    targets.set(key,targets.has(key)&&targets.get(key)!==url?null:url);
  };
  let references=false;
  for(const node of items){
    if(bcCitationHeading(node)){references=true;continue;}
    if(!references)continue;
    if(typeof node==='string'&&!node.trim())continue;
    if(!I.isValidElement(node)||!['ol','ul','p'].includes(node.type)||!bcCitationHasLink(node)){references=false;continue;}
    if(node.type==='ol')I.Children.toArray(node.props.children).filter(v=>I.isValidElement(v)&&v.type==='li').forEach((row,index)=>add((node.props.start??1)+index,row));
    else if(node.type==='p'){
      const number=bcCitationText(node).match(/^\s*\[(\d{1,3})\]/)?.[1];
      if(number)add(number,node);
    }
  }
  return targets;
}
function bcNormalizeCitationChildren(children,targets) {
  const merged=[];
  for(const child of I.Children.toArray(children)){
    if(typeof child==='string'&&typeof merged[merged.length-1]==='string')merged[merged.length-1]+=child;
    else merged.push(child);
  }
  return merged.flatMap((node,index)=>{
    if(typeof node==='string'){
      const result=[];let end=0;
      for(const match of node.matchAll(/<sup>\s*\[(\d{1,3})\]\s*<\/sup>/gi)){
        result.push(node.slice(end,match.index));
        const number=match[1],url=targets.get(number);
        result.push(url?d.jsx('a',{className:'bc-inline-citation',href:url,target:'_blank',rel:'noopener noreferrer',children:`[${number}]`},`bc-cite-${index}-${match.index}`):`[${number}]`);
        end=match.index+match[0].length;
      }
      result.push(node.slice(end));return result;
    }
    // Do not interpret HTML, code samples or arbitrary custom-component children.
    if(!I.isValidElement(node)||typeof node.type!=='string'||['code','pre','a'].includes(node.type))return [node];
    // Markdown separators, line breaks, images and checkboxes are void elements.
    // Adding even an empty children array makes React reject the whole answer.
    if(node.props.children===undefined||node.props.dangerouslySetInnerHTML)return [node];
    return [I.cloneElement(node,{},bcNormalizeCitationChildren(node.props.children,targets))];
  });
}
function bcRenderCitations(nodes) {
  const original=Array.isArray(nodes)?nodes:[nodes];
  const items=bcNormalizeCitationChildren(original,bcCitationTargets(original)),result=[];
  for(let index=0;index<items.length;index++) {
    const heading=items[index];
    if(!bcCitationHeading(heading)){result.push(heading);continue;}
    let end=index+1;
    const body=[];
    for(;end<items.length;end++) {
      const node=items[end];
      if(typeof node==='string'&&!node.trim()){body.push(node);continue;}
      if(!I.isValidElement(node)||!['ol','ul','p'].includes(node.type)||!bcCitationHasLink(node))break;
      body.push(node);
    }
    if(!body.some(bcCitationHasLink)){result.push(heading);continue;}
    result.push(d.jsxs('details',{className:'bc-references',children:[
      d.jsxs('summary',{children:[
        d.jsxs('svg',{className:'bc-references-icon',width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round','aria-hidden':true,children:[d.jsx('path',{d:'M7 5h14M7 12h14M7 19h14'}),d.jsx('path',{d:'M3 5h.01M3 12h.01M3 19h.01',strokeWidth:2.6})]}),
        d.jsx('span',{className:'bc-references-title',children:'全部引用'}),
        d.jsx('svg',{className:'bc-references-chevron',width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,children:d.jsx('path',{d:'m6 9 6 6 6-6'})})]}),
      d.jsx('div',{className:'bc-references-content',children:bcReferenceList(body)})
    ]},`bc-references-${heading.key??index}`));
    index=end-1;
  }
  return result;
}
