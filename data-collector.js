const csv = require("csv-parser");
const fse = require("fs-extra");

const pathSrc = "./src";

async function loadCountriesFromCSV(filePath) {
  const countriesByCode = {};

  return new Promise((resolve, reject) => {
    fse
      .createReadStream(filePath)
      .pipe(csv({}))
      .on("data", (data) => {
        const {country_code, country_name, currency_code} = data;

        countriesByCode[country_code] = {
          country_name,
          currency_code
        }
      })
      .on("end", () => {
        resolve(countriesByCode);
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}


async function build() {
  console.info("Collecting data...");

  const countries = await loadCountriesFromCSV(`${pathSrc}/data/countries.csv`);

}

build();
