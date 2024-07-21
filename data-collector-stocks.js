const csv = require("csv-parser");
const fse = require("fs-extra");
const path = require("path");
const yahooFinance = require('yahoo-finance2').default;

const pathSrc = path.join(".", "src");
const pathData = path.join(pathSrc, "data");
const pathCollected = path.join(pathData, "_collected");
const pathCollectedStocks = path.join(pathCollected, "stocks");

const stocksInfo = {};

async function loadStocksInfoFromCSV() {
  return new Promise((resolve, reject) => {
    fse
      .createReadStream(path.join(pathData, "stocks.csv"))
      .pipe(csv({}))
      .on("data", (data) => {
        const {symbol,name,filename} = data;
        stocksInfo[symbol] = { name, filename };
      })
      .on("end", () => {
        resolve();
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

async function loadStockHistoryFromRemoteAPI(symbol, from, to, period) {
  return await yahooFinance.historical(symbol, {
    period1: from,
    period2: to,
    interval: period
  })
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

async function build() {
  console.info("Collecting Stocks data...");

  await loadStocksInfoFromCSV();

  const stockSymbols = Object.keys(stocksInfo);
  const dFrom = new Date(Date.UTC(2013,3,1,0,0,0,0));
  const dNow = new Date();
  const strYYYYMMDDFrom = dateToYYYYMMDD(dFrom);
  const strYYYYMMDDNow = dateToYYYYMMDD(dNow);

  for (const symbol of stockSymbols) {
    console.log(symbol);
    const symbolHistory = await loadStockHistoryFromRemoteAPI(symbol, strYYYYMMDDFrom, strYYYYMMDDNow, "1mo");
    console.log(symbolHistory);
    symbolHistory.sort((v1,v2) => ((new Date(v1.date)).getTime() > (new Date(v2.date)).getTime()) ? 1 : -1);
    let lastClose;
    let symbolData;
    for (let itemIdx=0; itemIdx<symbolHistory.length; itemIdx++) {
      const { open, close, date } = symbolHistory[itemIdx];
      lastClose=close;
      const d = new Date(date);
      const strYYYYMMDD = dateToYYYYMMDD(d);

      if (!symbolData) {
        symbolData = [];
      }
      if (d.getUTCDate() === 1) {
        symbolData.push([strYYYYMMDD, open]);
      }
    }
    if (dNow.getUTCDate() > 1) {
      symbolData.push([strYYYYMMDDNow, lastClose]);
    }

    const stockFilename = stocksInfo[symbol].filename;
    const outFile = path.join(pathCollectedStocks, stockFilename + ".json");
    await fse.writeFile(outFile, JSON.stringify(symbolData, null, 2));
    console.info(`${symbol} saved as ${stockFilename}`);
  }
}

build();
