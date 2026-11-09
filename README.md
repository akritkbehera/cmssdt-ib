# CMSSDT IB page

This is source code for new [CMSSDT IB page](https://cmssdt.cern.ch/SDT/html/cmssdt-ib-react19).  
It uses **React 19** and **Vite**. It must be built before deploying.

## To start local development

```bash
# Start node container
docker run -it --rm --name my-running-script -v "$PWD":/usr/src/app:z -w /usr/src/app -p 5173:5173 node:20 bash

# populate environment with latest testing data
./public/updateData.sh

# install dependencies
npm install

# For development server
npm run start

# For testing the changes in production build
npm run build
npm run preview

Open browser and access localhost:5173

## GitHub Pages

The `build:pages` mode points the dashboard at the public CMS data feeds and
links CERN-only validation and log pages back to CERN. It does not copy the
production `/data/sdt/SDT` tree into this repository. The dashboard and those
public data feeds are accessible to anyone who can view the Pages site.

The workflow in `.github/workflows/deploy-pages.yml` builds and deploys on
pushes to `master`, or when run manually from the Actions tab. To enable the
first deployment, open **Settings → Pages** for the fork and set **Build and
deployment → Source** to **GitHub Actions**. The site URL will be
`https://akritkbehera.github.io/cmssdt-ib/` after the first successful deploy.

To build the Pages version locally, use `npm run build:pages` with Node 24.
