// scripts/verify-heygen-digital-twin.mjs
//
// Manual verification tool — NOT part of the app runtime.
// Confirms this HeyGen account has Digital Twin (video avatar) API access
// and prints the real response shapes, since third-party documentation was
// the only source available while designing this feature.
//
// Usage:
//   HEYGEN_API_KEY=... node scripts/verify-heygen-digital-twin.mjs <training_footage_url>
//
// <training_footage_url> must be a publicly reachable MP4 (2-5 min, 720p+,
// one continuous shot of the person talking on camera, per HeyGen's
// requirements). Upload a test clip anywhere public (e.g. Supabase Storage
// with a public URL) and pass that URL.

const apiKey = process.env.HEYGEN_API_KEY;
const videoUrl = process.argv[2];

if (!apiKey) {
  console.error('Set HEYGEN_API_KEY in the environment before running this script.');
  process.exit(1);
}
if (!videoUrl) {
  console.error('Usage: node scripts/verify-heygen-digital-twin.mjs <training_footage_url>');
  process.exit(1);
}

async function main() {
  console.log('1. Uploading training footage as a HeyGen asset...');
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    console.error(`Could not fetch the training footage URL itself (${videoRes.status}). It must be public.`);
    process.exit(1);
  }
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

  const form = new FormData();
  form.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), 'training.mp4');
  const uploadRes = await fetch('https://api.heygen.com/v3/assets', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey },
    body: form,
  });
  const uploadJson = await uploadRes.json().catch(() => ({}));
  console.log(`   Status: ${uploadRes.status}`);
  console.log('   Body:', JSON.stringify(uploadJson, null, 2));
  const assetId = uploadJson?.data?.asset_id;
  if (!uploadRes.ok || !assetId) {
    console.error('   Asset upload failed or returned no asset_id — stopping here.');
    process.exit(1);
  }

  console.log('\n2. Creating a digital_twin avatar from that asset...');
  const createRes = await fetch('https://api.heygen.com/v3/avatars', {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'digital_twin', name: 'verification-spike', file: { type: 'asset_id', asset_id: assetId } }),
  });
  const createJson = await createRes.json().catch(() => ({}));
  console.log(`   Status: ${createRes.status}`);
  console.log('   Body:', JSON.stringify(createJson, null, 2));
  if (createRes.status === 403 || createRes.status === 401) {
    console.error('\n   This looks like an access/plan problem: this HeyGen account may not have Digital Twin enabled.');
    process.exit(1);
  }
  const groupId = createJson?.data?.avatar_group?.id ?? createJson?.data?.avatar_item?.group_id;
  if (!createRes.ok || !groupId) {
    console.error('   Digital twin creation failed or returned no group id — stopping here.');
    process.exit(1);
  }

  console.log('\n3. Requesting Level-1 (hosted webcam) consent...');
  const consentRes = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}/consent`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const consentJson = await consentRes.json().catch(() => ({}));
  console.log(`   Status: ${consentRes.status}`);
  console.log('   Body:', JSON.stringify(consentJson, null, 2));

  console.log('\n4. Fetching the avatar group status directly...');
  const statusRes = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  const statusJson = await statusRes.json().catch(() => ({}));
  console.log(`   Status: ${statusRes.status}`);
  console.log('   Body:', JSON.stringify(statusJson, null, 2));

  console.log('\nDone. Compare the "Body" shapes above against src/integrations/index.ts\'s');
  console.log('createVideoAvatar/requestConsent/getAvatarGroupStatus parsing (added later in this');
  console.log('plan) and adjust the field paths there if the real shape differs.');
}

main().catch(e => { console.error(e); process.exit(1); });
