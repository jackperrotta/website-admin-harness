import {isWebsiteTheme,type WebsiteTheme} from '../../../contracts/src/index.ts';

const neutral:Required<WebsiteTheme>={colorBg:'#f7f8fa',colorText:'#252b33',colorMuted:'#65707e',colorAccent:'#3b5069',colorAccentText:'#ffffff',colorSurface:'#ffffff',colorSurface2:'#eef1f5',colorBorder:'#dce1e7',colorFocus:'#4975aa'};
const mappings={colorBg:'--canvas',colorText:'--ink',colorMuted:'--muted',colorAccent:'--accent',colorAccentText:'--accent-ink',colorSurface:'--surface',colorSurface2:'--sidebar',colorBorder:'--line',colorFocus:'--focus'} as const;
function luminance(color:string){const hex=color.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)?.[1];if(!hex)return undefined;const rgb=(hex.length===3?[...hex].map(c=>c+c).join(''):hex).match(/../g)!.map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
export function applyWebsiteTheme(root:HTMLElement,theme:WebsiteTheme|null|undefined){
 const valid=isWebsiteTheme(theme)?theme:{};
 const colors={...neutral,...valid};
 colors.colorFocus=valid.colorFocus||colors.colorAccent;
 // When an older site's tokens omit inverse text, choose readable black/white
 // for its solid accent instead of carrying another brand's inverse color.
 if(valid.colorAccent&&!valid.colorAccentText){
  const light=luminance(valid.colorAccent);
  if(light!==undefined)colors.colorAccentText=light>.179?'#111111':'#ffffff';
 }
 for(const [key,variable] of Object.entries(mappings))root.style.setProperty(variable,colors[key as keyof WebsiteTheme]);
 root.style.colorScheme=(luminance(colors.colorBg)??1)<.179?'dark':'light';
}
