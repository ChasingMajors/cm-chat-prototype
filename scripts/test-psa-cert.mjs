const token = process.env.PSA_ACCESS_TOKEN || "";
const certNumber = process.argv[2] || process.env.PSA_CERT_NUMBER || "";

if (!token) {
  console.error("Missing PSA_ACCESS_TOKEN environment variable.");
  process.exit(1);
}

if (!certNumber) {
  console.error("Usage: PSA_ACCESS_TOKEN='token' node scripts/test-psa-cert.mjs <cert-number>");
  process.exit(1);
}

const url = `https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`;

const response = await fetch(url, {
  method: "GET",
  headers: {
    authorization: `bearer ${token}`,
    accept: "application/json"
  }
});

const text = await response.text();
let data = text;

try {
  data = JSON.parse(text);
} catch (err) {
  // Keep raw text. PSA may return plain text for some auth or validation errors.
}

console.log(JSON.stringify({
  ok: response.ok,
  status: response.status,
  statusText: response.statusText,
  certNumber,
  data
}, null, 2));
