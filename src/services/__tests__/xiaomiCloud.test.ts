import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiUrl, decryptResponse, encParams, makeNonce, parseStartJson, signedNonce } from '../xiaomiCloudCore';

// Expected values computed with a line-by-line Python copy of token_extractor.py's
// signed_nonce / generate_enc_params / encrypt_rc4 (RC4 with 1024 dropped bytes).
test('Xiaomi cloud request signing matches the reference implementation', () => {
  const ssec = 'Q2hlY2tTZWN1cml0eTEyMw==';
  const nonce = makeNonce(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]), 12345 * 60000 + 59999);
  assert.equal(nonce, 'AAECAwQFBgcAADA5');
  const sn = signedNonce(ssec, nonce);
  assert.equal(sn, '9kTOUjXSNM1gf6DAA0epMDF9T1pjvX6YzQL7kUADEFU=');
  const url = `${apiUrl('de')}/share/askbluetoothkey`;
  assert.equal(url, 'https://de.api.io.mi.com/app/share/askbluetoothkey');
  assert.deepEqual(encParams(url, 'POST', sn, nonce, [['data', '{"type":"own","did":"123","keyid":0}']], ssec), [
    ['data', 'JuHA9SxdkPVOXOGYsTy3WHgmwCRZ9T2agkJd0TCIzawr7iyp'],
    ['rc4_hash__', 'DpDE9T9J3KkKXb2V8iLwTnABjnIC8lnLkzsMhw=='],
    ['signature', 'fzhz3o37a/jTDyjbguKRFdnUrQ4='],
    ['ssecurity', ssec],
    ['_nonce', nonce],
  ]);
  assert.equal(decryptResponse(ssec, nonce, 'JuHX4zhdkPVcH7SE9mPgUGVg2GVZr2rQglRd2zfT2bU='), '{"code":0,"result":{"key":"ab"}}');
  assert.equal(apiUrl('cn'), 'https://api.io.mi.com/app');
  assert.deepEqual(parseStartJson('&&&START&&&{"a":1}'), { a: 1 });
});
