const https = require('https');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const paystackSvg = '<svg viewBox="0 0 24 24" fill="#0BA4DB" xmlns="http://www.w3.org/2000/svg"><path d="M11.91 0A11.956 11.956 0 000 12.09c0 6.64 5.38 11.92 12.02 11.91H24V0H11.91zm0 20.482a8.553 8.553 0 01-8.562-8.568 8.618 8.618 0 018.67-8.562 8.56 8.56 0 018.57 8.562v8.568H11.91z"/></svg>';
    console.log("PAYSTACK:");
    console.log(paystackSvg);
    
    // For Dodo Payments, the logo from their site
    // For Polar, the logo from their site
    const dodoHtml = await download('https://dodopayments.com/');
    const dodoMatch = dodoHtml.match(/<svg[^>]*>.*?<\/svg>/i);
    console.log("DODO:");
    // try finding logo svg
    console.log(dodoHtml.match(/<svg.+?Dodopayments.+?<\/svg>/is) ? 'Found Dodo' : 'Not Found Dodo');

    const polarHtml = await download('https://polar.sh/');
    console.log("POLAR:");
    console.log(polarHtml.match(/<svg.+?Polar.+?<\/svg>/is) ? 'Found Polar' : 'Not Found Polar');

  } catch (e) { console.error(e); }
})();
