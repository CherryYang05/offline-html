import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// The browser interfaces are controlled doubles. All file reads and commits
// exercise temporary disk files and never touch the template.
const directory = await mkdtemp(join(tmpdir(), 'offline-html-writeback-'));
const folder = pathToFileURL(directory + '/');
const path = new URL('runner/report.html', folder);
const wrong = new URL('other/report.html', folder);
const base = '<html><head><title>Generic report</title></head><body><p>Baseline</p></body></html>';
const external = base.replace('Generic','Updated');
const mtime = new Date(2026,10,25,15,0,0);
const restore = async () => { await writeFile(path,base); await utimes(path,mtime,mtime); await writeFile(wrong,base); await utimes(wrong,mtime,mtime); };
const runtime = await readFile(new URL('../offline-report.html', import.meta.url), 'utf8');
function slice(start, end) {
  const from = runtime.indexOf(start);
  const to = runtime.indexOf(end, from);
  assert.ok(from !== -1 && to > from, 'Missing writeback runtime: ' + start);
  return runtime.slice(from, to);
}
const functions = ['  function changed()', '  function decodedPath()', '  function authoredSnapshot(doc)'].map((start,i)=>slice(start,['  function openPanel()', '  function download(', '  $(\'#review-connect\').addEventListener'][i])).join('\n');
class Parser { parseFromString(text){return {childNodes:[{nodeType:1,outerHTML:text}]};} }

function setup({supportsPicker=true}={}) {
  const nodes = new Map();
  const $ = name => { if(!nodes.has(name))nodes.set(name,{dataset:{}}); return nodes.get(name); };
  const qa = { selected:null, text:'First edit', writes:0, aborts:0, opens:0, timers:new Map(), messages:[] };
  const context = vm.createContext({qa, $, status:$('#review-status'), window:{isSecureContext:true},
    location:{protocol:'file:',pathname:path.pathname}, document:{}, Node:{ELEMENT_NODE:1},
    DOMException, DOMParser:Parser, XMLSerializer:class {}, TextEncoder, TextDecoder,
    notify:message=>qa.messages.push(message), uid:()=>String(qa.writes+1),
    serialize:id=>`${base.replace('Baseline',qa.text)}<!-- revision ${id} -->`,
    setTimeout:callback => { const id=Symbol(); qa.timers.set(id,callback); return id; },
    clearTimeout:id=>qa.timers.delete(id),
  });
  if(supportsPicker)context.window.showOpenFilePicker=async()=>{qa.opens++; if(qa.cancel)throw new DOMException('cancel','AbortError');return [qa.selected];};
  vm.runInContext(`
    const openedSnapshot = ${JSON.stringify(base)};
    const openedModification = '11/25/2026 15:00:00';
    let fileHandle = null, originalHandle = null, expectedBytes = null;
    let revision = 0, hasWritten = false, saveBusy = false, connecting = false, saveProblem = '';
    let dirty = false, activeComposition = 0, autoSaveTimer = 0;
    ${functions}
    Object.assign(qa, { saveHTML, changed, syncFileButton, composing:count=>activeComposition=count });
  `,context);
  qa.handle = (target,{name='report.html'}={}) => ({
    name,
    location:target.href,
    isSameEntry:async other=>target.href===other.location,
    getFile:async()=>new File([await readFile(target)],name,{lastModified:(await stat(target)).mtimeMs}),
    queryPermission:async()=>qa.permission||'granted',
    requestPermission:async()=>qa.permission||'granted',
    createWritable:async options=>{
      assert.equal(options.mode,'exclusive');
      if(qa.error)throw new DOMException('fault',qa.error);
      const staged=new URL('pending.tmp',target);
      return {
        write:async bytes=>{await writeFile(staged,bytes); if(qa.duringWrite)await qa.duringWrite();},
        abort:async()=>{qa.aborts++;await unlink(staged);},
        close:async()=>{await rename(staged,target);qa.writes++;}
      };
    }
  });
  qa.selected=qa.handle(path);
  qa.status=()=>$('#review-status').textContent;
  qa.dirty=()=>$('#review-connect').dataset.dirty==='true';
  qa.clickSave=qa.saveHTML;
  qa.flush=async()=>{const callbacks=[...qa.timers.values()];qa.timers.clear();for(const cb of callbacks)await cb();};
  qa.edit=text=>{qa.text=text;qa.changed();};
  qa.menu=()=>$('#review-save-menu').open;
  qa.syncFileButton();
  return qa;
}

try {
  for (const subdirectory of ['runner/', 'other/']) await mkdir(new URL(subdirectory, folder));
  await restore();
  {
    const qa=setup();
    await qa.clickSave(); assert.match(qa.status(),/已连接原文件/); assert.equal(qa.writes,0);
    qa.edit('First edit'); await qa.flush(); assert.match(await readFile(path,'utf8'),/First edit/); assert.equal(qa.dirty(),false);
    qa.duringWrite=async()=>{qa.edit('Edit arriving during staged write');qa.duringWrite=null;};
    qa.edit('Second edit'); await qa.clickSave(); assert.equal(qa.dirty(),true);
    await qa.flush(); assert.match(await readFile(path,'utf8'),/Edit arriving during staged write/); assert.equal(qa.writes,3);
    console.log('PASS clean connection, first disk write, autosave queues newer edit during write');
  }
  await restore();
  {
    const qa=setup();
    let permissionRequested=false;
    await writeFile(wrong,external); await utimes(wrong,mtime,mtime);
    qa.selected=qa.handle(wrong); qa.selected.queryPermission=async()=>{permissionRequested=true;return 'granted';};
    await qa.clickSave(); assert.match(qa.status(),/版本不同/); assert.equal(permissionRequested,false);
    await writeFile(wrong,base);await utimes(wrong,new Date(mtime.getTime()-5000),new Date(mtime.getTime()-5000));
    await qa.clickSave(); assert.match(qa.status(),/版本不同/);
    qa.selected=qa.handle(path,{name:'copy.html'}); await qa.clickSave(); assert.match(qa.status(),/HTML 原文件/);
    console.log('PASS first selection rejects other name, same-name altered head, same-name copy with different modification time');
  }
  await restore();
  {
    const qa=setup();qa.permission='denied';qa.edit('Pending after denied permission');await qa.clickSave();
    assert.match(qa.status(),/未授予/);qa.edit('Pending after follow-up edit');assert.match(qa.status(),/未授予/);
    assert.equal(await readFile(path,'utf8'),base);
    qa.cancel=true;await qa.clickSave();assert.match(qa.status(),/未授予/);qa.cancel=false;
    qa.permission='granted';await qa.clickSave();assert.match(await readFile(path,'utf8'),/follow-up edit/);
    qa.error='NotAllowedError';qa.edit('After revocation');await qa.clickSave();assert.match(qa.status(),/已不可写入/);
    qa.selected=qa.handle(wrong);await qa.clickSave();assert.match(qa.status(),/HTML 原文件/);
    qa.selected=qa.handle(path);qa.error=null;await qa.clickSave();assert.match(await readFile(path,'utf8'),/After revocation/);
    console.log('PASS denied permission, picker cancellation, revocation simulation, reconnect identity and recovery');
  }
  await restore();
  {
    const qa=setup();await qa.clickSave();await writeFile(path,external);
    qa.edit('Unsaved after conflict');await qa.clickSave();assert.match(qa.status(),/磁盘文件已有更新/);
    qa.edit('Current edits preserved');assert.equal(qa.dirty(),true);assert.equal(qa.writes,0);assert.equal(await readFile(path,'utf8'),external);
    await qa.clickSave();assert.match(qa.status(),/磁盘文件已有更新/);assert.equal(await readFile(path,'utf8'),external);
    console.log('PASS same-size external change is preserved and persists after attempted reconnect');
  }
  await restore();
  {
    const qa=setup();await qa.clickSave();qa.duringWrite=()=>writeFile(path,external);
    qa.edit('Staged before external change');await qa.clickSave();assert.equal(qa.aborts,1);assert.equal(qa.writes,0);assert.equal(await readFile(path,'utf8'),external);
    console.log('PASS external change after staging aborts write before commit');
  }
  await restore();
  {
    const qa=setup();await qa.clickSave();qa.edit('Safe retry');qa.error='NoModificationAllowedError';await qa.clickSave();
    assert.match(qa.status(),/另一处写入/);assert.equal(qa.dirty(),true);assert.equal(qa.timers.size,0);
    qa.error='UnknownError';await qa.clickSave();assert.match(qa.status(),/写回未完成/);assert.equal(qa.timers.size,0);
    qa.error=null;qa.composing(1);await qa.clickSave();assert.equal(qa.writes,0);qa.composing(0);qa.changed();await qa.clickSave();assert.match(await readFile(path,'utf8'),/Safe retry/);
    qa.edit('Committed after composition');qa.composing(1);await qa.flush();assert.equal(qa.writes,1);qa.composing(0);qa.changed();await qa.flush();assert.match(await readFile(path,'utf8'),/Committed after composition/);
    console.log('PASS lock and other write failure stop automatic retries, manual or deferred composition write succeeds');
  }
  {
    const qa=setup({supportsPicker:false});qa.edit('Unsaved');await qa.clickSave();assert.equal(qa.menu(),true);assert.match(qa.status(),/导出 HTML 副本/);
    console.log('PASS unsupported picker exposes file menu and export fallback');
  }
} finally {
  await rm(directory, {recursive:true, force:true});
}
