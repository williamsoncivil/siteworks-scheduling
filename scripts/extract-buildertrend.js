#!/usr/bin/env node
// Buildertrend data extraction script
// Uses session cookies from logged-in browser session

const https = require('https');
const fs = require('fs');
const path = require('path');

const COOKIES = 'reauth-cookie-heartbeat=true; GAESA=CrYBMDBkYTZjZDJjNDMzYzEwZjNjZjkwMTQyYjFhZDExNGUwZTIwYzEyOWU3ZTUzZWQ5N2NjOWNmZWQxYjQ0ZjI3ZDc5MjAwZjZkYTdkMjk2ZjQzZGYwOTA5NDFkNGNhNTUzYzYyZDczY2Q1MDRkZjI4ZGQwN2E0YTc1ZjE4YmMzMTgwNDljNjRjNTU5ZDU2NzAwNTQ0N2M4ZDZjMzFhOWZiMTM4MjFiNzdiNTE0MmIxMzAwZTZmNzQQ3pzwx80z';

function get(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'buildertrend.net',
      path,
      method: 'GET',
      headers: {
        'Cookie': COOKIES,
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://buildertrend.net/app/Schedules/5'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ _raw: data.slice(0, 200), _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchRange(start, end) {
  const path = `/apix/v2/Schedules/range?Start=${start}T00:00:00&End=${end}T23:59:00`;
  return get(path);
}

async function fetchItem(id) {
  return get(`/api/calendar/${id}`);
}

async function main() {
  console.log('Fetching all schedule items via date range sweep...');
  
  const ranges = [
    ['2024-01-01', '2024-04-01'],
    ['2024-04-01', '2024-07-01'],
    ['2024-07-01', '2024-10-01'],
    ['2024-10-01', '2025-01-01'],
    ['2025-01-01', '2025-04-01'],
    ['2025-04-01', '2025-07-01'],
    ['2025-07-01', '2025-10-01'],
    ['2025-10-01', '2026-01-01'],
    ['2026-01-01', '2026-04-01'],
    ['2026-04-01', '2026-07-01'],
    ['2026-07-01', '2026-10-01'],
    ['2026-10-01', '2027-01-01'],
  ];

  const itemIds = new Set();
  
  for (const [start, end] of ranges) {
    console.log(`  Fetching range ${start} → ${end}...`);
    const data = await fetchRange(start, end);
    if (data.scheduleItems) {
      data.scheduleItems.forEach(i => itemIds.add(i.scheduleId));
      console.log(`    Got ${data.scheduleItems.length} items (total unique: ${itemIds.size})`);
    } else {
      console.log(`    Response: ${JSON.stringify(data).slice(0, 100)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nTotal unique items: ${itemIds.size}`);
  console.log('Fetching full details for each item...');
  
  const allItems = [];
  const ids = [...itemIds];
  
  for (let i = 0; i < ids.length; i++) {
    process.stdout.write(`\r  ${i + 1}/${ids.length}`);
    const detail = await fetchItem(ids[i]);
    if (detail && !detail._raw) {
      allItems.push({
        id: detail.id,
        title: detail.title?.value,
        jobId: detail.jobId,
        jobName: detail.jobInfo?.name,
        startDate: detail.startDate?.value,
        endDate: detail.endDate?.value,
        durationDays: detail.duration?.value,
        phase: detail.phase?.value || null,
        percentComplete: detail.percentComplete?.value || 0,
        isCompleted: detail.isCompleted?.value || false,
        completedDate: detail.completedDate?.value || null,
        color: detail.displayColor?.value || null,
        notes: detail.internalNotes?.value || null,
        assignees: (detail.assignedTo?.value || []).flatMap(g =>
          (g.options || []).filter(o => o.selected).map(o => ({ id: o.id, name: o.name }))
        ),
        predecessors: (detail.predecessors || []).map(p => ({
          id: p.id,
          predecessorItemId: p.scheduleItem?.value?.[0]?.id,
          predecessorItemName: p.scheduleItem?.value?.[0]?.name || p.title,
          type: (p.linkedType?.value || []).find(t => t.selected)?.name || 'Finish-to-Start (FS)',
          lagDays: p.numLagDays || 0
        })),
        files: (detail.attachedFiles?.value || []).map(f => ({
          id: f.id,
          name: f.fileName || f.name,
          url: f.fileUrl || f.url
        }))
      });
    }
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`\n\nSuccessfully fetched ${allItems.length} items`);
  
  // Group by job
  const byJob = {};
  allItems.forEach(item => {
    const key = item.jobName || item.jobId;
    if (!byJob[key]) byJob[key] = [];
    byJob[key].push(item);
  });
  
  console.log('\nJobs found:');
  Object.entries(byJob).forEach(([job, items]) => {
    const phases = [...new Set(items.map(i => i.phase).filter(Boolean))];
    console.log(`  ${job}: ${items.length} items, phases: ${phases.join(', ') || 'none tagged'}`);
  });
  
  const outPath = path.join(__dirname, '../buildertrend-import.json');
  fs.writeFileSync(outPath, JSON.stringify(allItems, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch(console.error);
