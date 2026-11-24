import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReviewChannel } from '../src/windows-review-chat.js';

test('the acceptance demo uses two disposable real hook runs and reports only what its loopback audit received',async t=>{
  const feature=await import('../examples/review-chat-demo.js').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
  assert.equal(typeof feature.createReviewDemo,'function','offline demo is available');
  const d=await feature.createReviewDemo();
  t.after(()=>d.close());
  const channel=createReviewChannel(d.options);t.after(()=>channel.close());
  const list=await channel.request({type:'list'});assert.equal(list.demo,true);assert.equal(list.tasks.length,2);
  const a=list.tasks.find(x=>x.goal.includes('任务 A')),b=list.tasks.find(x=>x.goal.includes('任务 B'));
  await channel.request({type:'select',target:a,view:1});
  const draft=await channel.request({type:'message',text:'校对图注里的数字',target:a,view:1,mode:'draft'});
  assert.match(draft.draft,/图注/);
  const audit=target=>channel.request({type:'demoStop',target,view:1});
  assert.match((await audit(a)).text,/没有收到任务专属规则/);
  await channel.request({type:'apply',target:a,view:1,text:'只检查尺码。'});
  assert.match((await audit(a)).text,/只检查尺码/);
  await channel.request({type:'select',target:b,view:2});
  assert.match((await audit(b)).text,/没有收到任务专属规则/);
  channel.close();await d.close();assert.equal(fs.existsSync(d.options.home),false);
});
