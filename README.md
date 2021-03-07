# Store of {Something}

This is a template repository for making "Store of {Something}" websites.

## Getting Started

1. Generate a new GitHub repository by clicking the `Use this template` button at the top of the repository homepage.
2. Your repository will be configured to auto build and deploy the website to the `gh-pages` branch when commits pushed to the `master` and every day at 12:00 UTC. This allows you to edit your website right from GitHub.
3. If you prefer to edit on your computer, then clone your repository and install dependencies: `yarn install`. And `yarn dev` will start the builder in dev watch mode.
4. Configure a publishing source for your Github Pages site as per [GitHub guide](https://docs.github.com/en/github/working-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#choosing-a-publishing-source). Set the `gh-pages` branch as the publishing source.
5. Your website is active and can be accessed via the url provided by GitHub Pages or on your domain if you configured it. The repository is preloaded with Big Mac data, so you should see a copy of "Store of Big Macs" website when you open your website url in the browser.
6. Now update the website with your data as per instructions below.

## Project Structure

```
store-of-something/
 └──src/                             * source files of the website
     │
     ├──assets/                      * folder for image files
     │   ├──logo.svg                 * logo picture
     │   └──og-1200x628.png          * image for social networks
     │
     ├──data/                        * folder for website data files
     │   ├──*.csv                    * .csv files with pricing history datasets
     │   └──something.json           * configuration file
     │
     └──templates/                   * folder for website templates
         └──index.ejs                * homepage template

```

## Updating Website Data

1. `src/assets/logo.svg` - replace this file with your logo picture
2. `src/assets/og-1200x628.png` - replace this file with your image for social networks (dimensions 1200x628)
3. `src/data/big-mac-raw-index.csv` - remove this file and add your pricing datasets in CSV format to the `src/data/` folder. CSV file requirements:
   - it should have a date column in `YYYY-MM-DD` format and a USD price column
   - The first row should be a header row with column names.
4. `src/data/something.csv` - edit the configuration file:
   - `singular` - name of {something} (singular)
   - `plural` - name of {something} (plural)
   - `icon` - emoji of {something}
   - `logo` - url of the logo picture for the website (if empty, emoji is used)
   - `year` - configures the year dropdown:
     - `from` - set first year available in the year dropdown
     - `default` - default year picked in the year dropdown
   - `category` - configures the category dropdown:
     - `in` - "in" for the "in {category}
     - `default` - default category picked in the category dropdown
   - `csvColumnNames` - configures the column names in CSV files to load the data from:
     - `date` - column with dates
     - `category` - column with categories
     - `usdPrice` - column with USD prices
   - `stores` - configures stores that will be loaded from CoinGecko API and available on the stores dropdown in the following format:
     - `key` sets the currency id as per CoinGecko API specs (for example, `xau` for Gold or `xag` for Silver)
     - `value` is the name visible on the store dropdown
       },
   - `dataSources` - data source credits
     - `what` - dataset name
     - `providedBy` - name of the dataset provider
     - `link` - link to the dataset/provider
   - `credits` - other credits (the same structure as for `dataSources`)
   - `repoLink` - link to your website repository
   - `colors` - your website theme color
     - `primary` - primary color
     - `secondary` - secondary color
     - `background` - background color
     - `bitcoin` - bitcoin color
   - `madeBy` - info about you
     - `idOrName` - name or id of your social profile or your homepage
     - `link` - link to your social profile or homepage
   - `website` - website/meta info
     - `rootUrl` - full url to your website, starting with `https://` and ending with `/`
     - `title` - website title
     - `description` - website description
     - `twitter` - info for twitter cards
       - `creator` - your twitter handler
       - `site` - your or your website's twitter handler

## Developing Website

Build in Watch mode:

```
yarn dev
```

## License

MIT © Alex Kaul
