import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMediaManifestIndex } from '../../src/lib/content-source/media-manifest-contract.mjs';
import { projectHyImageReferences } from '../../src/lib/content-source/hy-legacy-images.mjs';

function hyFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...hyFiles(path));
    else if (entry.isFile() && entry.name === 'hy.json') files.push(path);
  }
  return files;
}

const manifest = JSON.parse(readFileSync('src/data/content/media-manifest.v1.json', 'utf8'));
const mediaIndex = createMediaManifestIndex(manifest);
const seenUrls = new Set();
const report = {
  mode: 'read-only',
  hy_articles_with_images: 0,
  unique_image_urls: 0,
  already_registered: 0,
  eligible_for_r2_verification: 0,
  manual_review: 0,
  prevented_duplicates: 0,
  samples_requiring_manual_review: [],
};

for (const file of hyFiles('src/data/content/dreams')) {
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const images = projectHyImageReferences(document?.published?.content ?? '', mediaIndex);
  if (images.length) report.hy_articles_with_images += 1;
  for (const image of images) {
    if (seenUrls.has(image.source_url)) { report.prevented_duplicates += 1; continue; }
    seenUrls.add(image.source_url);
    if (image.asset_id) report.already_registered += 1;
    else if (image.ownership === 'owned_r2') report.eligible_for_r2_verification += 1;
    else {
      report.manual_review += 1;
      if (report.samples_requiring_manual_review.length < 20) report.samples_requiring_manual_review.push(image.source_url);
    }
  }
}
report.unique_image_urls = seenUrls.size;
console.log(JSON.stringify(report, null, 2));
