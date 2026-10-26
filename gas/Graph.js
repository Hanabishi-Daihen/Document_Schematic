/**
 * เชื่อมต่อ Microsoft Graph API (OneDrive องค์กร) ด้วย client credentials
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ITEM_SELECT = 'id,name,cTag,file,folder,fileSystemInfo,lastModifiedBy,webUrl,size,parentReference';

function graphToken_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get('graph_token');
    if (cached) return cached;
  }
  const p = props_();
  const tenant = p.getProperty('TENANT_ID');
  const clientId = p.getProperty('CLIENT_ID');
  const secret = p.getProperty('CLIENT_SECRET');
  if (!tenant || !clientId || !secret) {
    throw new Error('ยังไม่ได้ตั้งค่า TENANT_ID / CLIENT_ID / CLIENT_SECRET ใน Script Properties');
  }
  const res = UrlFetchApp.fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'post',
    payload: {
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error(`ขอ token ไม่สำเร็จ: ${body.error || res.getResponseCode()} — ${body.error_description || ''}`);
  }
  cache.put('graph_token', body.access_token, Math.max(60, Math.min(body.expires_in - 300, 21600)));
  return body.access_token;
}

/** เรียก Graph พร้อม retry เมื่อโดน throttle (429) หรือ server error */
function graphFetch_(pathOrUrl, options) {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : GRAPH_BASE + pathOrUrl;
  let refreshed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = UrlFetchApp.fetch(url, Object.assign({
      method: 'get',
      headers: { Authorization: 'Bearer ' + graphToken_(refreshed) },
      muteHttpExceptions: true,
    }, options || {}));
    const code = res.getResponseCode();
    if (code === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (code === 429 || code >= 500) {
      const retryAfter = Number(res.getHeaders()['Retry-After']) || Math.pow(2, attempt);
      Utilities.sleep(Math.min(retryAfter, 30) * 1000);
      continue;
    }
    if (code >= 400) {
      let msg = res.getContentText();
      try { msg = JSON.parse(msg).error.message; } catch (e) { /* ใช้ข้อความดิบ */ }
      throw new Error(`Graph ${code}: ${String(msg).slice(0, 300)}`);
    }
    return res;
  }
  throw new Error(`Graph: ลองใหม่หลายครั้งแล้วไม่สำเร็จ (${url})`);
}

function graphJson_(pathOrUrl) {
  return JSON.parse(graphFetch_(pathOrUrl).getContentText());
}

/**
 * แปลงสิ่งที่ Admin ใส่ให้เป็น driveItem รองรับ 2 แบบ
 *   1) ลิงก์แชร์ OneDrive/SharePoint  https://xxx-my.sharepoint.com/:f:/g/personal/...
 *   2) "อีเมลเจ้าของ:/path/โฟลเดอร์"  เช่น somchai@company.com:/Documents/QA  (ใช้เมื่อ /shares ใช้ไม่ได้)
 */
function resolveSourceInput_(input) {
  input = String(input || '').trim();
  let item;
  if (/^https?:\/\//i.test(input)) {
    const encoded = 'u!' + Utilities.base64EncodeWebSafe(input, Utilities.Charset.UTF_8).replace(/=+$/, '');
    item = graphJson_(`/shares/${encoded}/driveItem?$select=${ITEM_SELECT}`);
  } else {
    const m = input.match(/^([^\s:/]+@[^\s:/]+):(.*)$/);
    if (!m) throw new Error('รูปแบบไม่ถูกต้อง: ใส่ลิงก์ OneDrive หรือ อีเมล:/path/โฟลเดอร์');
    const path = m[2].replace(/^\/+|\/+$/g, '');
    const upn = encodeURIComponent(m[1]);
    item = graphJson_(path
      ? `/users/${upn}/drive/root:/${path.split('/').map(encodeURIComponent).join('/')}?$select=${ITEM_SELECT}`
      : `/users/${upn}/drive/root?$select=${ITEM_SELECT}`);
  }
  return {
    driveId: item.parentReference && item.parentReference.driveId,
    itemId: item.id,
    name: item.name,
    kind: item.folder ? 'folder' : 'file',
  };
}

/** รายการไฟล์ทั้งหมดใต้ source (ไล่โฟลเดอร์ย่อย) → [{item, relPath}] */
function listSourceItems_(source) {
  if (source.kind === 'file') {
    return [{ item: graphJson_(`/drives/${source.drive_id}/items/${source.item_id}?$select=${ITEM_SELECT}`), relPath: '' }];
  }
  const out = [];
  const queue = [{ id: source.item_id, rel: '' }];
  let folders = 0;
  while (queue.length) {
    const { id, rel } = queue.shift();
    if (++folders > 2000) throw new Error('โฟลเดอร์ย่อยมากเกิน 2,000 โฟลเดอร์');
    let url = `/drives/${source.drive_id}/items/${id}/children?$select=${ITEM_SELECT}&$top=200`;
    while (url) {
      const page = graphJson_(url);
      page.value.forEach((child) => {
        if (child.folder) queue.push({ id: child.id, rel: rel ? `${rel}/${child.name}` : child.name });
        else if (child.file) out.push({ item: child, relPath: rel });
      });
      url = page['@odata.nextLink'] || null;
    }
  }
  return out;
}

function getItem_(driveId, itemId) {
  return graphJson_(`/drives/${driveId}/items/${itemId}?$select=${ITEM_SELECT}`);
}

/** ดาวน์โหลดไฟล์: Graph ตอบ 302 ไปยัง URL ที่ยืนยันตัวตนแล้ว จึงตามไปโดยไม่ส่ง token ต่อ */
function downloadItem_(driveId, itemId) {
  const res = graphFetch_(`/drives/${driveId}/items/${itemId}/content`, { followRedirects: false });
  if (res.getResponseCode() === 302) {
    const location = res.getHeaders().Location || res.getHeaders().location;
    return UrlFetchApp.fetch(location).getBlob();
  }
  return res.getBlob();
}
