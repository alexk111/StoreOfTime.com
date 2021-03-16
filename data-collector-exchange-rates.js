const https = require("https");
const path = require("path");

const fse = require("fs-extra");

const oxrAppId = process.env.OXR_APP_ID;

if (!oxrAppId) {
  throw new Error("No OXR_APP_ID specified")
}

const pathSrc = "./src";
const pathCollected = pathSrc + "/data/_collected";
const pathCollectedUSDRates = pathCollected + "/usd-rates";

let currencies;

async function loadCurrenciesFromFile() {
  const pathFile = path.join(pathCollected, "currencies.json");
  const fileData = await fse.readFile(pathFile);
  currencies = JSON.parse(fileData);
}

function dateToYYYYMM(d) {
    let month = '' + (d.getUTCMonth() + 1);
    const year = d.getUTCFullYear();

    if (month.length < 2) {
      month = '0' + month;
    }

    return [year, month].join('-');
}

function dateToYYYYMMDD(d) {
  let month = '' + (d.getUTCMonth() + 1);
  let date = '' + d.getUTCDate();
  const year = d.getUTCFullYear();

  if (month.length < 2) {
    month = '0' + month;
  }

  if (date.length < 2) {
    date = '0' + date;
  }

  return [year, month, date].join('-');
}

async function loadExchangeRatesFromRemoteAPI(strYYYYMMDD) {
  const url = `https://openexchangerates.org/api/historical/${strYYYYMMDD}.json?app_id=${oxrAppId}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", async () => {
          try {
            const gotData = JSON.parse(body);
            if (!gotData.rates) {
              throw new Error("Got empty rates");
            }
            resolve(gotData.rates);
          } catch (error) {
            reject(error.message);
          }
        });
      })
      .on("error", (error) => {
        reject(error.message);
      });
  });
}

async function build() {
  console.info("Collecting Exchange Rates data...");

  await loadCurrenciesFromFile();

  if (!currencies) {
    throw new Error ("Collect currencies data first!");
  }

  let dPointer = new Date(Date.UTC(2013,3,1,0,0,0,0));
  const dNow = new Date();
  const dEndPointer = new Date(dNow);
  dEndPointer.setUTCDate(1);
  dEndPointer.setUTCHours(0,0,0,0);
  if (dNow.getUTCDate()<=5) {
    dEndPointer.setUTCMonth(dEndPointer.getUTCMonth()-1);
  }

  // First update monthly rates
  let lastFinishedMonthRates;
  while (dPointer.getTime()<=dEndPointer.getTime()) {
    const strYYYYMM = dateToYYYYMM(dPointer);
    const outFile = path.join(pathCollectedUSDRates, strYYYYMM + ".json");
    if (fse.existsSync(outFile)) {
      const fileData = await fse.readFile(outFile);
      lastFinishedMonthRates = JSON.parse(fileData);
    } else {
      console.info(strYYYYMM);

      lastFinishedMonthRates = {};

      // some currencies might not have rates data on some days, so let's get values for a few dates and pick the earliest available
      for (const strDD of ["01", "03", "05"]) {
        const gotRates = await loadExchangeRatesFromRemoteAPI(`${strYYYYMM}-${strDD}`);
        lastFinishedMonthRates = Object.assign(gotRates, lastFinishedMonthRates);
      }
      await fse.writeFile(outFile, JSON.stringify(lastFinishedMonthRates, null, 2));
    }
    dPointer.setUTCMonth(dPointer.getUTCMonth()+1);
  }

  // Then update latest rates
  console.info("Latest");
  const strYYYYMMDD = dateToYYYYMMDD(dNow);
  const latestFile = path.join(pathCollectedUSDRates, "latest.json");
  let latestRates = lastFinishedMonthRates;
  if (fse.existsSync(latestFile)) {
    const fileData = await fse.readFile(latestFile);
    const parsedData = JSON.parse(fileData);
    if (parsedData.rates) {
      latestRates = parsedData.rates;
    }
  }
  const gotRates = await loadExchangeRatesFromRemoteAPI(strYYYYMMDD);
  latestRates = Object.assign(latestRates, gotRates);
  await fse.writeFile(latestFile, JSON.stringify({
    date: strYYYYMMDD,
    rates: latestRates
  }, null, 2));
}

build();
