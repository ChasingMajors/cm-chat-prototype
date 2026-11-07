import test from 'node:test';import assert from 'node:assert/strict';
import {manyFormats} from './print-run-lab-many-formats.mjs';
import {sanitizeProject,buildArtifact,validateArtifact,MAX_FORMATS} from '../print-run-lab/project-schema.js';
test('format cap is 24',()=>assert.equal(MAX_FORMATS,24));
test('a 14-format project passes sanitizeProject and buildArtifact',()=>{
  const project=manyFormats(14),clean=sanitizeProject(project);
  assert.equal(clean.formats.length,14);assert.equal(clean.packTotals.length,14);assert.ok(clean.rows.every(r=>r.odds.length===14));
  const artifact=buildArtifact(project,{projectId:'prl_00000000-0000',revisionId:'rev-00000001',publishedAt:'2026-01-01T00:00:00.000Z'});
  assert.equal(artifact.calculation.packTotals.length,14);validateArtifact(artifact);
});
test('12 formats still validate and 24 pass; 25 is rejected',()=>{
  assert.equal(sanitizeProject(manyFormats(12)).formats.length,12);
  assert.equal(sanitizeProject(manyFormats(24)).formats.length,24);
  assert.throws(()=>sanitizeProject(manyFormats(25)),/Invalid project list/);
});
