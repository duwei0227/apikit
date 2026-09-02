import { describe, expect, it } from 'vitest';
import { parseCurl } from '@/utils/curl-parser';

describe('cURL request settings', () => {
  it('parses redirect, TLS, and compression options', () => {
    const parsed = parseCurl(
      "curl --location --max-redirs 7 --insecure --compressed 'https://example.com'",
    );

    expect(parsed.settings).toEqual({
      followRedirects: true,
      maxRedirectCount: 7,
      verifySsl: false,
      autoEncodeUrl: true,
      acceptEncoding: true,
    });
  });

  it('uses curl-compatible defaults when no setting flags are present', () => {
    const parsed = parseCurl("curl 'https://example.com'");

    expect(parsed.settings).toEqual({
      followRedirects: false,
      maxRedirectCount: 10,
      verifySsl: true,
      autoEncodeUrl: true,
      acceptEncoding: false,
    });
  });

  it('uses curl default redirect limit for location without max-redirs', () => {
    const parsed = parseCurl("curl -L 'https://example.com'");

    expect(parsed.settings.followRedirects).toBe(true);
    expect(parsed.settings.maxRedirectCount).toBe(50);
  });

  it('recognizes max-redirs with equals and an explicit encoding header', () => {
    const parsed = parseCurl(
      "curl --location --max-redirs=3 -H 'Accept-Encoding: gzip, deflate, br' 'https://example.com'",
    );

    expect(parsed.settings.maxRedirectCount).toBe(3);
    expect(parsed.settings.acceptEncoding).toBe(true);
  });

  it('preserves a redirect limit without enabling redirects', () => {
    const parsed = parseCurl("curl --max-redirs 7 'https://example.com'");

    expect(parsed.settings.followRedirects).toBe(false);
    expect(parsed.settings.maxRedirectCount).toBe(7);
  });

  it('treats location-trusted as following redirects with a warning', () => {
    const parsed = parseCurl("curl --location-trusted 'https://example.com'");

    expect(parsed.settings.followRedirects).toBe(true);
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ option: '--location-trusted' }));
  });

  it('applies negated setting options in command order', () => {
    const disabled = parseCurl(
      "curl -L -k --compressed --no-location --no-insecure --no-compressed 'https://example.com'",
    );
    const reenabled = parseCurl(
      "curl --no-location --no-insecure --no-compressed -L -k --compressed 'https://example.com'",
    );

    expect(disabled.settings).toMatchObject({
      followRedirects: false,
      verifySsl: true,
      acceptEncoding: false,
    });
    expect(reenabled.settings).toMatchObject({
      followRedirects: true,
      verifySsl: false,
      acceptEncoding: true,
    });
  });

  it('tracks location and location-trusted independently', () => {
    const regularLocation = parseCurl(
      "curl --location --location-trusted --no-location-trusted 'https://example.com'",
    );
    const trustedLocation = parseCurl(
      "curl --location-trusted --location --no-location 'https://example.com'",
    );

    expect(regularLocation.settings.followRedirects).toBe(true);
    expect(regularLocation.warnings).not.toContainEqual(expect.objectContaining({ option: '--location-trusted' }));
    expect(trustedLocation.settings.followRedirects).toBe(true);
    expect(trustedLocation.warnings).toContainEqual(expect.objectContaining({ option: '--location-trusted' }));
  });
});

describe('Postman cURL compatibility', () => {
  it('does not let behavior-only or unknown options consume the URL', () => {
    const parsed = parseCurl(
      "curl --location --globoff --unknown value 'https://example.com/{{path}}'",
    );

    expect(parsed.url).toBe('https://example.com/{{path}}');
    expect(parsed.settings.followRedirects).toBe(true);
    expect(parsed.warnings[0]?.option).toBe('--unknown');
  });

  it('does not mistake common option values for the request URL', () => {
    const parsed = parseCurl(
      "curl --referer https://ref.example --output response.json https://api.example/users",
    );

    expect(parsed.url).toBe('https://api.example/users');
    expect(parsed.headers).toContainEqual(expect.objectContaining({
      key: 'Referer',
      value: 'https://ref.example',
    }));
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ option: '--output' }));
  });

  it('supports equals and attached-value option forms', () => {
    const parsed = parseCurl(
      "curl --request=POST -H'Content-Type: application/json' --data-raw='{\"name\":\"ApiKit\"}' --url='https://example.com/users'",
    );

    expect(parsed.method).toBe('POST');
    expect(parsed.url).toBe('https://example.com/users');
    expect(parsed.headers[0]).toMatchObject({ key: 'Content-Type', value: 'application/json' });
    expect(parsed.body.type).toBe('json');
    expect(parsed.body.raw).toBe('{"name":"ApiKit"}');
  });

  it('distinguishes form files from text fields', () => {
    const parsed = parseCurl(
      "curl -F 'avatar=@\"/tmp/avatar.png\";type=image/png' --form-string 'literal=@not-a-file' https://example.com/upload",
    );

    expect(parsed.body.type).toBe('form-data');
    expect(parsed.body.formData[0]).toMatchObject({
      key: 'avatar',
      value: 'avatar.png',
      filePath: '/tmp/avatar.png',
      type: 'file',
    });
    expect(parsed.body.formData[1]).toMatchObject({
      key: 'literal',
      value: '@not-a-file',
      type: 'text',
    });
  });

  it('preserves plain text and binary request bodies', () => {
    const text = parseCurl(
      "curl -H 'Content-Type: text/plain' --data-raw 'hello world' https://example.com",
    );
    const binary = parseCurl(
      "curl --data-binary '@\"/tmp/archive.bin\"' https://example.com/upload",
    );

    expect(text.body).toMatchObject({ type: 'text', raw: 'hello world' });
    expect(binary.body).toMatchObject({ type: 'binary', filePath: '/tmp/archive.bin' });
  });

  it('does not mistake JSON containing an equals sign for urlencoded data', () => {
    const parsed = parseCurl(
      "curl --data-raw '{\"filter\":\"a=b\"}' https://example.com/search",
    );

    expect(parsed.body).toMatchObject({ type: 'json', raw: '{"filter":"a=b"}' });
  });

  it('maps literal cookies to a header and warns about unsupported transport options', () => {
    const parsed = parseCurl(
      "curl --cookie 'session=abc' --proxy http://proxy.test:8080 https://example.com",
    );

    expect(parsed.url).toBe('https://example.com');
    expect(parsed.headers[0]).toMatchObject({ key: 'Cookie', value: 'session=abc' });
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ option: '--proxy' }));
  });

  it('warns about cookie files instead of turning the filename into a Cookie header', () => {
    const parsed = parseCurl("curl --cookie cookies.txt https://example.com");

    expect(parsed.headers).not.toContainEqual(expect.objectContaining({ key: 'Cookie' }));
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ option: '--cookie' }));
  });
});
