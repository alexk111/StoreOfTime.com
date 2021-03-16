const csv = require("csv-parser");
const fse = require("fs-extra");
const path = require("path");
const yahooFinance = require('yahoo-finance');

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

async function loadStockHistoryFromRemoteAPI(symbols, from, to, period) {
  return new Promise((resolve, reject) => {
    yahooFinance.historical({
      symbols,
      from,
      to,
      period // 'd' (daily), 'w' (weekly), 'm' (monthly), 'v' (dividends only)
    }, function (err, quotes) {
      if (err) {
        reject(err);
      } else {
        resolve(quotes);
      }
    });
  });
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

  const history = await loadStockHistoryFromRemoteAPI(stockSymbols, strYYYYMMDDFrom, strYYYYMMDDNow, "m");
  const dataBySymbols = {};

  for (const symbol of stockSymbols) {
    for (const item of history[symbol]) {
      const { symbol, open, close, date } = item;
      const d = new Date(date);
      const strYYYYMMDD = dateToYYYYMMDD(d);

      if (!dataBySymbols[symbol]) {
        dataBySymbols[symbol] = [];
      }
      dataBySymbols[symbol].push([strYYYYMMDD, open]);
      if (
        (d.getUTCFullYear() === dNow.getUTCFullYear()) &&
        (d.getUTCMonth() === dNow.getUTCMonth()) &&
        (dNow.getUTCDate() > 1)
      ) {
        dataBySymbols[symbol].push([strYYYYMMDDNow, close]);
      }
    }

    dataBySymbols[symbol].sort((v1,v2) => v1[0] > v2[0] ? 1 : -1)
    const stockFilename = stocksInfo[symbol].filename;
    const outFile = path.join(pathCollectedStocks, stockFilename + ".json");
    await fse.writeFile(outFile, JSON.stringify(dataBySymbols[symbol], null, 2));
    console.info(`${symbol} saved as ${stockFilename}`);
  }
}

build();
