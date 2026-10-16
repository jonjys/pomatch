/* POMatch — deterministic, offline CSV 3-way matching. No external dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ALIASES = {
    sku: ['sku','artikelnummer','artikel','item','itemcode','productcode','productsku','itemsku','varunummer','productid'],
    ordered: ['orderedqty','orderedquantity','orderqty','quantityordered','ordered','bestalltant','bestalltantal','bestalldantal','antalbestallt','quantity','qty','antal'],
    received: ['receivedqty','receivedquantity','quantityreceived','received','mottagetantal','mottaget','levereratantal','deliveredqty','quantity','qty','antal'],
    invoiced: ['invoicedqty','invoicedquantity','quantityinvoiced','invoiced','faktureratantal','fakturerat','quantity','qty','antal'],
    price: ['unitprice','price','pris','styckpris','unitcost','cost','netprice','enhetspris','apris','unitpriceexvat']
  };
  const norm = v => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

  function delimiterOf(text) {
    const first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).find(x => x.trim());
    if (!first) throw new Error('The file is empty.');
    const counts = {',':0,';':0,'\t':0}; let quoted = false;
    for (let i=0;i<first.length;i++) {
      if(first[i]==='"'){if(quoted && first[i+1]==='"')i++; else quoted=!quoted;}
      else if(!quoted && Object.hasOwn(counts,first[i]))counts[first[i]]++;
    }
    const [d,count] = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    if(!count)throw new Error('No CSV delimiter found (comma, semicolon or tab).');
    return d;
  }
  function parseCSV(text) {
    const input = String(text).replace(/^\uFEFF/, '');
    const delimiter = delimiterOf(input);
    const rows = []; let row=[], value='', quoted=false;
    for(let i=0;i<input.length;i++){
      const c=input[i];
      if(c==='"'){
        if(quoted && input[i+1]==='"'){value+='"';i++;}
        else if(quoted){quoted=false;}
        else if(value===''){quoted=true;}
        else throw new Error('Invalid quote in CSV file.');
      } else if(!quoted && c===delimiter){row.push(value.trim());value='';}
      else if(!quoted && (c==='\n'||c==='\r')){
        if(c==='\r' && input[i+1]==='\n')i++;
        row.push(value.trim());value='';
        if(row.some(v=>v!==''))rows.push(row);
        row=[];
      } else value+=c;
    }
    if(quoted)throw new Error('CSV contains an unclosed quoted field.');
    row.push(value.trim());if(row.some(v=>v!==''))rows.push(row);
    if(rows.length<2)throw new Error('CSV needs a header and at least one data row.');
    if(rows.length>50001)throw new Error('Maximum 50,000 data rows per file.');
    return {headers:rows[0], rows:rows.slice(1)};
  }
  function findCol(headers, key) {
    const h=headers.map(norm);return h.findIndex(x=>ALIASES[key].includes(x));
  }
  function numberFrom(value, kind, row) {
    let v=String(value??'').replace(/[\s\u00a0\u202fkr€$]/gi,'').trim();
    if(!v)throw new Error(`Row ${row}: ${kind} is missing.`);
    // Grouping formats: 1 234,50 / 1,234.50 / 1.234,50.
    const comma=v.lastIndexOf(','), dot=v.lastIndexOf('.');
    if(comma!==-1 && dot!==-1){v=comma>dot?v.replace(/\./g,'').replace(',','.'):v.replace(/,/g,'');}
    else if(comma!==-1){v=v.replace(',','.');}
    if(!/^\d+(\.\d+)?$/.test(v)) throw new Error(`Row ${row}: invalid value for ${kind}.`);
    const n=Number(v);
    if(!Number.isFinite(n)||n>1e10)throw new Error(`Row ${row}: ${kind} is too large.`);
    return n;
  }
  function centsFrom(value,row){const v=numberFrom(value,'unit price',row);if(Math.round(v*100)/100!==v)throw new Error(`Row ${row}: unit price must have at most two decimal places.`);if (v > 10_000_000) throw new Error(`Row ${row}: unit price is too large.`);return Math.round(v*100);}
  function qtyFrom(value,row){const n=numberFrom(value,'quantity',row);if(!Number.isSafeInteger(n) || n > 1_000_000)throw new Error(`Row ${row}: quantity must be a whole number up to 1,000,000.`);return n;}
  function readLines(text,kind){
    const parsed=parseCSV(text), cols={sku:findCol(parsed.headers,'sku'),qty:findCol(parsed.headers,kind)};
    if(kind!=='received')cols.price=findCol(parsed.headers,'price');
    for(const [key,idx] of Object.entries(cols))if(idx<0)throw new Error(`${kind}: missing ${key} column. Headers: ${parsed.headers.join(', ')}`);
    const map=new Map();
    parsed.rows.forEach((row,i)=>{
      const line=i+2, sku=String(row[cols.sku]??'').trim().toUpperCase();
      if(!sku || sku.length>90)throw new Error(`Row ${line}: SKU is missing or too long.`);
      const qty=qtyFrom(row[cols.qty],line);
      const price=kind==='received'?null:centsFrom(row[cols.price],line);
      const old=map.get(sku);
      if(old && old.price!==price)throw new Error(`SKU ${sku} has conflicting unit prices. Split the lines or use an export with one price per SKU.`);
      const totalQty = qty + (old?.qty || 0);
      if (!Number.isSafeInteger(totalQty) || totalQty > 1_000_000) throw new Error(`SKU ${sku}: total quantity exceeds 1,000,000.`);
      map.set(sku,{sku,qty:totalQty,price});
    });
    return map;
  }
  function compare(orderCSV,receiptCSV,invoiceCSV){
    const order=readLines(orderCSV,'ordered'),received=readLines(receiptCSV,'received'),invoice=readLines(invoiceCSV,'invoiced');
    const all=[...new Set([...order.keys(),...received.keys(),...invoice.keys()])].sort();
    const items=all.map(sku=>{
      const po=order.get(sku),rec=received.get(sku),inv=invoice.get(sku);
      const q1=po?.qty??0,q2=rec?.qty??0,q3=inv?.qty??0;
      const priceDiff=(inv?.price??0)-(po?.price??0);
      const issues=[];
      if(!po)issues.push('Missing from PO');
      if(!rec)issues.push('Missing from receipt');
      if(!inv)issues.push('Missing from invoice');
      if(q2<q1)issues.push('Under-delivered');
      if(q2>q1)issues.push('Over-delivered');
      if(q3>q2)issues.push('Invoiced more than received');
      if(q3<q2)issues.push('Received more than invoiced');
      if(po && inv && priceDiff!==0)issues.push('Unit price differs');
      const qtyOver=Math.max(0,q3-q2);
      const excessUnitsCents=(po && inv ? qtyOver*inv.price:0);
      const priceOverCents=(po && inv ? Math.min(q2,q3)*Math.max(0,priceDiff):0);
      const estimatedOverCents=excessUnitsCents+priceOverCents;
      return {sku,ordered:q1,received:q2,invoiced:q3,poPrice:po?.price??null,invoicePrice:inv?.price??null,issues,estimatedOverCents};
    });
    const mismatches=items.filter(x=>x.issues.length>0);
    return {items,mismatches,totalSKUs:items.length,issueRows:mismatches.length,estimatedOverCents:items.reduce((n,x)=>n+x.estimatedOverCents,0), note:'Indicative discrepancy amount before tax, freight and discounts. Verify source documents before making financial decisions.'};
  }
  function csvCell(v) {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV(result){
    const h=['SKU','Ordered quantity','Received quantity','Invoiced quantity','PO unit price (minor units)','Invoice unit price (minor units)','Estimated overcharge (minor units)','Findings'];
    return '\uFEFF'+[h.join(';'),...result.mismatches.map(x=>[x.sku,x.ordered,x.received,x.invoiced,x.poPrice??'',x.invoicePrice??'',x.estimatedOverCents,x.issues.join(' | ')].map(csvCell).join(';'))].join('\r\n');
  }
  return {parseCSV,compare,exportCSV,readLines};
});
