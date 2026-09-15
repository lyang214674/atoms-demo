/**
 * Generated apps run in a sandboxed iframe *without* `allow-same-origin`, so the
 * browser gives them an opaque origin and throws on `window.localStorage`.
 * We inject this shim at the top of <head>: if native storage is unavailable it
 * installs an in-memory Storage that mirrors every change to the parent window
 * via postMessage (the parent persists it and hands it back as `initial` on the
 * next load). Opening the raw file in a new tab (no parent) degrades to memory-only.
 */

export const STORAGE_MSG_TYPE = "atoms:storage";

export function storageShimScript(initial: Record<string, string> = {}): string {
  const init = JSON.stringify(initial).replace(/</g, "\\u003c");
  return `<script data-atoms-shim>(function(){
try{window.localStorage.getItem("__probe__");return;}catch(e){}
var data=Object.assign(Object.create(null),${init});
function sync(){try{if(window.parent!==window)window.parent.postMessage({type:"${STORAGE_MSG_TYPE}",data:Object.assign({},data)},"*");}catch(e){}}
function mk(){return{
getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(data,k)?data[k]:null;},
setItem:function(k,v){data[String(k)]=String(v);sync();},
removeItem:function(k){delete data[String(k)];sync();},
clear:function(){data=Object.create(null);sync();},
key:function(i){var ks=Object.keys(data);return i<ks.length?ks[i]:null;},
get length(){return Object.keys(data).length;}
};}
try{Object.defineProperty(window,"localStorage",{value:mk(),configurable:true});}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:mk(),configurable:true});}catch(e){}
})();</script>`;
}

/** Insert the shim as the first thing inside <head> (or before <html> content as fallback). */
export function injectStorageShim(html: string, initial?: Record<string, string>): string {
  if (html.includes("data-atoms-shim")) return html;
  const shim = storageShimScript(initial);
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + shim + html.slice(at);
  }
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag && htmlTag.index !== undefined) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${shim}</head>` + html.slice(at);
  }
  return shim + html;
}
