import {isWebsiteTheme,type WebsiteTheme} from '../../../contracts/src/index.ts';

const neutral:Required<WebsiteTheme>={colorBg:'#f7f8fa',colorText:'#252b33',colorMuted:'#65707e',colorAccent:'#3b5069',colorAccentText:'#ffffff',colorSurface:'#ffffff',colorSurface2:'#eef1f5',colorBorder:'#dce1e7',colorFocus:'#4975aa'};
const mappings={colorBg:'--canvas',colorText:'--ink',colorMuted:'--muted',colorAccent:'--accent',colorAccentText:'--accent-ink',colorSurface:'--surface',colorSurface2:'--sidebar',colorBorder:'--line',colorFocus:'--focus'} as const;
function rgba(color:string):number[]|undefined{
 const hex=color.match(/^#([0-9a-f]{3,8})$/i)?.[1];
 if(hex){const full=hex.length<=4?[...hex].map(c=>c+c).join(''):hex;const values=full.match(/../g)!.map(c=>parseInt(c,16)/255);return [...values.slice(0,3),values[3]??1];}
 const match=color.match(/^(rgba?|hsla?)\(([^()]+)\)$/i);if(!match)return;
 const parts=match[2].trim().split(/[\s,/]+/),alpha=parts[3]===undefined?1:parseFloat(parts[3])/(parts[3].endsWith('%')?100:1);
 if(match[1].toLowerCase().startsWith('rgb'))return [...parts.slice(0,3).map(p=>parseFloat(p)/(p.endsWith('%')?100:255)),alpha];
 const hue=((parseFloat(parts[0])%360)+360)%360/30,s=parseFloat(parts[1])/100,l=parseFloat(parts[2])/100,a=s*Math.min(l,1-l),channel=(n:number)=>{const k=(n+hue)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
 return [channel(0),channel(8),channel(4),alpha];
}
function luminance(color:string,background='#ffffff'){
 const value=rgba(color),base=rgba(background);if(!value)return;
 const rgb=value.slice(0,3).map((c,i)=>c*value[3]+((base?.[i]??1)*(base?.[3]??1)+1-(base?.[3]??1))*(1-value[3])).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
export function applyWebsiteTheme(root:HTMLElement,theme:WebsiteTheme|null|undefined){
 const valid=isWebsiteTheme(theme)?theme:{};
 const colors={...neutral,...valid};
 colors.colorFocus=valid.colorFocus||colors.colorAccent;
 // When an older site's tokens omit inverse text, choose readable black/white
 // for its solid accent instead of carrying another brand's inverse color.
 if(valid.colorAccent&&!valid.colorAccentText){
  const light=luminance(valid.colorAccent,colors.colorSurface);
  if(light!==undefined)colors.colorAccentText=light>.179?'#111111':'#ffffff';
 }
 for(const [key,variable] of Object.entries(mappings))root.style.setProperty(variable,colors[key as keyof WebsiteTheme]);
 root.style.colorScheme=(luminance(colors.colorBg)??1)<.179?'dark':'light';
}
