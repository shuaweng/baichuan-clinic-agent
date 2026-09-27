import {defineTool} from '../dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
import {loadKnowledgeBase} from './core.mjs';

export const name='tool-medical-kb';
export const inject=['tools'];
export function apply(ctx) {
  const kb=loadKnowledgeBase();
  const output={schema:{type:'object',additionalProperties:true},
    render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}],
    presentationMeta:(_args,value)=>value};
  const register=(definition)=>ctx.tools.register(defineTool({...definition,output,
    isConcurrencySafe:()=>true,
    presentCall:args=>({card:'generic',kind:'search',title:definition.label,rawInput:args.query??args.id??'知识源与适用范围'}),
    presentResult:(_args,result)=>{
      if(result.isError||!result.meta)return undefined;
      const value=result.meta;
      const refs=value.results?.map(r=>({url:r.source.url,title:r.source.title_zh+' · '+r.locator,snippet:r.snippet}))
        ?? (value.source?[{url:value.source.url,title:value.source.title_zh+' · '+value.locator,snippet:value.text?.slice(0,500)}]:[]);
      return refs.length?{card:'web',kind:'search',title:definition.label,sources:refs,truncated:false}:undefined;
    }
  }));
  register({name:'medical_kb_search',label:'检索妇幼参考资料',
    description:'Search the local, versioned WHO/CDC reference excerpts in Chinese or English. Read-only, no external network. Limited populations and topics, not an exhaustive clinical knowledge base. Read complete matching chunks before citing.',
    parameters:{query:{type:'string',required:true,description:'Focused topic keywords; use English synonyms if no Chinese match. Avoid patient identifiers.'},specialty:{type:'string',enum:['all','gynecology','pediatrics']},limit:{type:'integer',description:'Number of results: an integer from 1 to 6, default 4. Never request more than 6.'}},
    execute:async args=>kb.search(args.query,{specialty:args.specialty??'all',limit:args.limit??4})});
  register({name:'medical_kb_read',label:'查看医学来源原文',
    description:'Read the full local evidence chunk returned by medical_kb_search, including original table context, cell/row locator, version, population and source link. Retrieval is not verification of clinical applicability.',
    parameters:{id:{type:'string',required:true,description:'Exact chunk ID from medical_kb_search; never invent IDs.'}},
    execute:async args=>kb.read(args.id)});
  register({name:'medical_kb_sources',label:'知识来源与覆盖范围',
    description:'List available knowledge sources, populations, versions, licenses and limitations. No live web search; no patient data access.',
    parameters:{specialty:{type:'string',enum:['all','gynecology','pediatrics']}},
    execute:async args=>kb.sources(args.specialty??'all')});
}
