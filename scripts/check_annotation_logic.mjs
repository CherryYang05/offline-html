import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../offline-report.html',import.meta.url),'utf8');
const code=source.split('// BEGIN ANNOTATION LOGIC')[1]?.split('// END ANNOTATION LOGIC')[0];
assert.ok(code,'Missing annotation logic');
const {locateTextAnchor:locate,shiftTextAnchor:shift,packAnnotationSlots:pack,annotationTextHash:hash}=Function(code+';return {locateTextAnchor,shiftTextAnchor,packAnnotationSlots,annotationTextHash};')();
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const anchor=(text,start,end)=>({start,end,quote:text.slice(start,end),originalQuote:text.slice(start,end),prefix:text.slice(Math.max(0,start-24),start),suffix:text.slice(end,end+24),textHash:hash(text)});

test('Stable paragraph permits the exact stored offset',()=>{
 const a=anchor('甲乙甲乙',2,3);assert.equal(locate('甲乙甲乙',a).start,2);
});
test('Context relocates a repeated quote after external insertion',()=>{
 const a=anchor('左甲一，右甲二',5,6);assert.equal(locate('前缀左甲一，右甲二',a).start,7);
});
test('Ambiguous repeated text is rejected instead of guessed',()=>{
 assert.equal(locate('甲 甲',{quote:'甲',start:-1,prefix:'',suffix:''}),null);
});
test('Changed paragraph does not trust a stale matching offset',()=>{
 const a={quote:'甲',start:1,end:2,prefix:'右',suffix:'二',textHash:hash('右甲二')};
 assert.equal(locate('左甲一，右甲二',a).start,5);
});
test('Insertion before a quote shifts its offset',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','新增abc DEF ghi');assert.equal(a.start,6);assert.equal(a.quote,'DEF');
});
test('Edits after the quote do not move it',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','abc DEF 末尾');assert.equal(a.start,4);assert.equal(a.end,7);
});
test('A partial edit inside the selection updates its current quote',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','abc DXF ghi');assert.equal(a.quote,'DXF');assert.equal(a.originalQuote,'DEF');assert.ok(a.edited);
});
test('Replacing the last selected character keeps its replacement inside the anchor',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','abc DEX ghi');assert.equal(a.quote,'DEX');assert.equal(a.end,7);
});
test('Replacing the first selected character keeps its replacement inside the anchor',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','abc XEF ghi');assert.equal(a.quote,'XEF');assert.equal(a.start,4);
});
test('UTF-16 offsets remain valid when an emoji changes inside a larger anchor',()=>{
 const before='前🙂后';const a=anchor(before,0,before.length);shift(a,before,'前🙃后');assert.equal(a.quote,'前🙃后');assert.equal(a.end,4);
});
test('Whole-paragraph replacement can retain an unchanged quote',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','前文 DEF 后文');assert.equal(a.start,3);assert.equal(a.quote,'DEF');assert.ok(!a.orphaned);
});
test('Removing a selected quote preserves an orphan for rebinding',()=>{
 const a=anchor('abc DEF ghi',4,7);shift(a,'abc DEF ghi','abc ghi');assert.ok(a.orphaned);assert.equal(a.originalQuote,'DEF');
});
test('A shared full stop does not keep unrelated replacement text linked',()=>{
 const before='把一份文档，变成可讲、可改、可讨论的汇报。',a=anchor(before,0,before.length);
 shift(a,before,'这段文字已被替换，用于检查失去关联。');assert.ok(a.orphaned);
});
test('An explicit full selection is authoritative even if a prefix survives',()=>{
 const a=anchor('旧说法',0,3);shift(a,'旧说法','旧结论',{start:0,end:3});assert.ok(a.orphaned);
});
test('Collision avoidance is ordered and never overlaps',()=>{
 const slots=pack([{id:'a',desired:200,height:90},{id:'b',desired:205,height:70},{id:'c',desired:500,height:40}],160,12);
 assert.deepEqual(slots.map(s=>s.top),[200,302,500]);
 for(let i=1;i<slots.length;i++)assert.ok(slots[i].top>=slots[i-1].top+slots[i-1].height+12);
});
test('Packing reserves the rail header and keeps equal-anchor order',()=>{
 const slots=pack([{id:'a',desired:20,height:50},{id:'b',desired:20,height:50}],160,12);
 assert.deepEqual(slots.map(s=>[s.id,s.top]),[['a',160],['b',222]]);
});
console.log(checks+' annotation checks passed');
