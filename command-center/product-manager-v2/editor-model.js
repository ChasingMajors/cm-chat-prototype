(function (root) {
  'use strict';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const normalize = value => Array.isArray(value) ? value.map(normalize) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
  const equal = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  const protectedField = field => /^(?:id|product_id|group_id|code|sport|source_revision|schema_version|source_key|identity_status|issues|quality|raw|provenance|source_provenance|calculation_provenance|constructor|prototype|__proto__)$|(?:^|_)(?:sha(?:256)?|hash|fingerprint)(?:_|$)/i.test(field);
  const display = value => value === undefined ? '' : value === null ? 'null' :
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  function preservesProtected(before, after) {
    if (!before && !after || typeof before !== 'object' && typeof after !== 'object') return true;
    const keys=new Set([...Object.keys(before??{}),...Object.keys(after??{})]);
    return [...keys].every(field=>protectedField(field)?equal(before?.[field],after?.[field]):
      equal(before?.[field],after?.[field])||preservesProtected(before?.[field],after?.[field]));
  }
  function parse(value, type) {
    if (type === 'string') return value;
    if (type === 'null') return null;
    if (type === 'absent') return undefined;
    if (type === 'boolean' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    if (type === 'number' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    throw Error('Enter a valid ' + type + ' value.');
  }

  class Draft {
    constructor(rows, defaults = {}) {
      this.defaults = defaults;
      this.next = rows.length;
      this.base = rows.map((data, i) => ({key:String(i), data:copy(data)}));
      this.rows = this.base;
      this.past = [];
      this.future = [];
      this.original = new Map(this.base.map(row => [row.key, row.data]));
      this.schema = new Set(rows.flatMap(Object.keys));
    }
    apply(next) {
      if (next.length===this.rows.length && next.every((row,i)=>row===this.rows[i] || equal(row,this.rows[i]))) return;
      this.past.push(this.rows);
      if (this.past.length > 60) this.past.shift();
      this.rows = next;
      this.future = [];
    }
    withEdits(edits) {
      const byRow = new Map();
      for (const e of edits) {
        if (protectedField(e.field) || !this.schema.has(e.field)) throw Error('This field is protected.');
        if (!byRow.has(e.key)) byRow.set(e.key, new Map());
        byRow.get(e.key).set(e.field, e.value);
      }
      return this.rows.map(row => {
        if (!byRow.has(row.key)) return row;
        const data = {...row.data};
        for (const [field, value] of byRow.get(row.key)) {
          if (!preservesProtected(data[field],value)) throw Error('This edit would change protected nested data.');
          if (value === undefined) delete data[field]; else data[field] = copy(value);
        }
        return {...row, data};
      });
    }
    update(edits) { this.apply(this.withEdits(edits)); }
    add(records = [{}], edits = []) {
      const next = records.map(record => ({key:String(this.next++), data:{
        ...Object.fromEntries(Object.entries(copy(record)).filter(([field]) => !protectedField(field))),
        ...this.defaults
      }}));
      this.apply([...this.withEdits(edits), ...next]);
      return next.map(row => row.key);
    }
    remove(keys) { this.apply(this.rows.filter(row => !keys.has(row.key))); }
    undo() { if (this.past.length) { this.future.push(this.rows); this.rows = this.past.pop(); } }
    redo() { if (this.future.length) { this.past.push(this.rows); this.rows = this.future.pop(); } }
    changes() {
      const current = new Map(this.rows.map(row => [row.key,row.data]));
      const keys = new Set([...this.original.keys(), ...current.keys()]);
      return [...keys].flatMap(key => {
        const before = this.original.get(key), after = current.get(key);
        return equal(before, after) ? [] : [{key, before, after}];
      });
    }
  }
  function readClipboard(text) {
    const rows = [[]];
    let value = '', quoted = false;
    for (let i=0; i<text.length; i++) {
      const char=text[i];
      if (char === '"' && quoted && text[i+1] === '"') { value += '"'; i++; }
      else if (char === '"' && (quoted || (!value && i < text.length-1))) quoted = !quoted;
      else if (!quoted && (char === '\t' || char === '\n' || char === '\r')) {
        rows.at(-1).push(value); value = '';
        if (char !== '\t' && (char !== '\r' || text[i+1] !== '\n')) rows.push([]);
        if (char === '\r' && text[i+1] === '\n') {i++; rows.push([]);}
      } else value += char;
    }
    if (quoted) throw Error('Clipboard contains an unclosed quoted cell.');
    if (value || rows.at(-1).length || rows.length === 1) rows.at(-1).push(value);
    if (!rows.at(-1).length) rows.pop();
    return rows;
  }
  const writeClipboard = rows => rows.map(row => row.map(value => /["\n\r\t]/.test(value) ? '"' + value.replaceAll('"','""') + '"' : value).join('\t')).join('\n');
  const api = {Draft, equal, parse, display, kind, protectedField, readClipboard, writeClipboard};
  if (typeof module === 'object') module.exports = api; else root.PMEditorModel = api;
})(globalThis);
