const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseCSV, compare, exportCSV } = require('./matcher.js');
const read = name => fs.readFileSync(`samples/${name}.csv`, 'utf8');

test('reads Swedish semicolon CSV with BOM', () => {const p=parseCSV('\ufeffSKU;Price\r\n"A;B";12,50\r\n');assert.equal(p.rows[0][0],'A;B');});
test('handles quoted commas, quotes and multiline content', () => {let p=parseCSV('sku,qty\n"A,""B""",2\n');assert.deepEqual(p.rows[0],['A,"B"', '2']);p=parseCSV('SKU,notes\nABC,"one\ntwo"\n');assert.equal(p.rows[0][1],'one\ntwo');});
test('rejects malformed quotes',()=>assert.throws(()=>parseCSV('a,b\n"bad,b'),/quoted field/));
test('detects shortage, overinvoice and unit price difference',()=>{const r=compare(read('purchase-order'),read('goods-received'),read('supplier-invoice'));assert.equal(r.totalSKUs,4);assert.equal(r.issueRows,2);assert.equal(r.estimatedOverCents,8*2450+50*100);const box=r.items.find(x=>x.sku==='BOX-100');assert.ok(box.issues.includes('Under-delivered'));assert.ok(box.issues.includes('Invoiced more than received'));const tape=r.items.find(x=>x.sku==='TAPE-200');assert.ok(tape.issues.includes('Unit price differs'));});
test('no differences for exact match',()=>{const row='SKU,qty,price\nA,10,1.20';const received='SKU,qty\nA,10';const r=compare(row,received,row);assert.equal(r.issueRows,0);assert.equal(r.estimatedOverCents,0);});
test('does not count unpriced items as monetary excess',()=>{let r=compare('SKU,qty,price\nA,5,5','SKU,qty\nA,5\nB,3','SKU,qty,price\nA,5,5\nB,3,10');assert.equal(r.estimatedOverCents,0);assert.ok(r.items.find(x=>x.sku==='B').issues.includes('Missing from PO'));});
test('rejects negative, noninteger and missing values',()=>{for(const qty of ['-1','3.5',''])assert.throws(()=>compare(`sku,qty,price\nA,${qty},12`,'sku,qty\nA,2','sku,qty,price\nA,2,12'));});
test('rejects conflicting duplicate prices',()=>assert.throws(()=>compare('sku,qty,price\nA,1,12\nA,2,13','sku,qty\nA,3','sku,qty,price\nA,3,12'),/conflicting unit prices/));
test('aggregates duplicate SKU rows with identical price',()=>{let r=compare('sku,qty,price\nA,1,12\nA,2,12','sku,qty\nA,3','sku,qty,price\nA,3,12');assert.equal(r.issueRows,0);});
test('escapes CSV output and has UTF8 BOM',()=>{let r=compare('sku,qty,price\n"A;B",1,12','sku,qty\n"A;B",0','sku,qty,price\n"A;B",1,12');assert.ok(exportCSV(r).startsWith('\ufeff'));assert.ok(exportCSV(r).includes('"A;B"'));});
test('CSV export includes only discrepancies and uses English headings',()=>{const result=compare('sku,qty,price\nA,1,10\nB,1,10','sku,qty\nA,1\nB,0','sku,qty,price\nA,1,10\nB,1,10');const csv=exportCSV(result);assert.ok(csv.includes('Ordered quantity'));assert.ok(csv.includes('B;1;0;1'));assert.ok(!csv.includes('A;1;1;1'));});
test('CSV export escapes potentially dangerous spreadsheet formulas',()=>{const result=compare('sku,qty,price\n=SUM(A1),1,10','sku,qty\n=SUM(A1),0','sku,qty,price\n=SUM(A1),1,10');const csv=exportCSV(result);assert.ok(csv.includes("'=SUM(A1)"));});
test('rejects quantities beyond safe limits',()=>{assert.throws(()=>compare('sku,qty,price\nA,1000001,10','sku,qty\nA,1','sku,qty,price\nA,1,10'),/1,000,000/);});
