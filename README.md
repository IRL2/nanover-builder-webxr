Github-CI: [![Build Status][build_status]][build_link]

[build_status]: ./../../actions/workflows/deploy.yml/badge.svg
[build_link]: ./../../actions/workflows/deploy.yml

# Nanover Builder WebXR
A WebXR Molecular Builder. Allows you to build, design and edit molecules in XR.


## How to use

```bash
git clone https://github.com/IRL2/nanover-builder-webxr.git
cd nanover-builder-webxr
npm install
```

Run a live server that opens a new browser tab and refreshes when you edit the code:

```bash
npm run dev
```

Build the standalone web package:

```bash
npm run build
```

Preview the standalone web package:
```bash
npm run preview
```

## WebXR and headset

For security, WebXR requires that the page be served over HTTPS, so you will need to configure the Live Server extension to use an SSL certificate.

To do so, install [OpenSSL](https://slproweb.com/products/Win32OpenSSL.html#downloads), and generate a private key and certificate:

* Either choose "nanover" as the passphrase or update it later in [the vite config](./vite.config.js)
* Skip all data input except `common name` which should be `localhost`

```
openssl genrsa -aes256 -out localhost.key 2048
openssl req -days 3650 -new -newkey rsa:2048 -key localhost.key -x509 -out localhost.pem
```