import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../offline-report.html',import.meta.url),'utf8');
const code=source.split('// BEGIN ANNOTATION LOGIC')[1]?.split('// END ANNOTATION LOGIC')[0];
assert.ok(code,'Missing annotation logic');
const {locateTextAnchor:locate,shiftTextAnchor:shift,annotationTextHash:hash}=Function(code+';return {locateTextAnchor,shiftTextAnchor,annotationTextHash};')();
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
test('Punctuation alone cannot choose between repeated quotes',()=>{
 const a=anchor('，甲。',1,2);
 assert.equal(locate('，甲。 甲',a),null);
});
test('The last surviving duplicate needs context from the original occurrence',()=>{
 const text='左侧原句后文；右侧原句说明';
 const start=text.indexOf('原句'),a=anchor(text,start,start+2);
 assert.equal(locate('右侧原句说明',a),null);
});
test('A different block needs contextual evidence',()=>{
 const a=anchor('前置信息指定引文后续说明',4,8);
 assert.equal(locate('只出现指定引文的无关段落',a,{requireContext:true}),null);
 assert.equal(locate('新段开头前置信息指定引文后续说明',a,{requireContext:true}).start,8);
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
test('Deleting one occurrence never jumps to the remaining identical text',()=>{
 const before='重复 重复';
 const removed=anchor(before,0,2), remaining=anchor(before,3,5);
 shift(removed,before,'重复',{start:0,end:3});
 shift(remaining,before,'重复',{start:0,end:3});
 assert.ok(removed.orphaned);assert.equal(remaining.start,0);assert.equal(remaining.quote,'重复');
});
test('An edit crossing the anchor boundary keeps only surviving selected text',()=>{
 const before='abc DEF ghi';
 const a=anchor(before,4,7);shift(a,before,'new EF ghi',{start:0,end:5});
 assert.equal(a.quote,'EF');assert.equal(a.start,4);
});
test('A repeated delete with no trustworthy edit range stays unresolved',()=>{
 const a=anchor('甲甲',0,1);shift(a,'甲甲','甲');assert.ok(a.orphaned);
});
test('Undo restores an orphan only when it restores the complete original paragraph',()=>{
 const before='甲 甲',a=anchor(before,0,1);
 shift(a,before,'甲',{start:0,end:2});
 shift(a,'甲','乙 甲',null,'historyUndo');assert.ok(a.orphaned);
 shift(a,'乙 甲',before,null,'historyUndo');assert.ok(!a.orphaned);assert.equal(a.start,0);
});
console.log(checks+' annotation checks passed');
