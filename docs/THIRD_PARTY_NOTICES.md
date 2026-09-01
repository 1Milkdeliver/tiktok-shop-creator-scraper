# Third-party notices

This application is distributed under the GNU General Public License, version 3.  The project license is the GPL-3.0 text in `LICENSE`; it does not convert the licenses of bundled third-party components.

`third-party-inventory.json` is the machine-readable, release-reviewed inventory for direct production dependencies, the Electron runtime, and the Python worker dependency set.  `package-lock.json` is the reproducible, integrity-pinned record of the complete npm dependency tree, including transitive packages.  A release must not change either dependency input without updating the inventory and this notice.

## Bundled production dependencies

| Component | License |
| --- | --- |
| @fontsource-variable/inter | SIL Open Font License 1.1 (OFL-1.1) |
| @fontsource-variable/noto-sans-sc | SIL Open Font License 1.1 (OFL-1.1) |
| @primer/octicons | MIT |
| electron-updater | MIT |
| exceljs | MIT |
| png2icons | MIT |
| pngjs | MIT |
| puppeteer-core | Apache License 2.0 |
| sqlite3 | BSD 3-Clause |
| Electron runtime | MIT |
| Python 3.11.9 Windows embedded runtime | Python Software Foundation License 2.0 (PSF-2.0) |

## Bundled Python worker dependencies

| Component | License |
| --- | --- |
| aiosqlite | MIT |
| annotated-types | MIT |
| anyio | MIT |
| beautifulsoup4 | MIT |
| certifi | MPL-2.0 |
| charset-normalizer | MIT |
| colorama | BSD License |
| defusedxml | Python Software Foundation License (PSFL) |
| fake-useragent | Apache-2.0 |
| h11 | MIT |
| httpcore | BSD-3-Clause |
| httpx | BSD-3-Clause |
| idna | BSD-3-Clause |
| instagrapi | MIT |
| loguru | MIT |
| pillow | MIT-CMU |
| py-machineid | MIT |
| pycountry | LGPL-2.1-only |
| pycryptodomex | BSD, Public Domain |
| pydantic | MIT |
| pydantic-core | MIT |
| pyotp | MIT |
| pysocks | BSD |
| requests | Apache-2.0 |
| soupsieve | MIT |
| twscrape | MIT |
| typing-extensions | PSF-2.0 |
| typing-inspection | MIT |
| urllib3 | MIT |
| win32-setctime | MIT |
| winregistry | MIT |
| ytscrape | MIT |

`runtime/python/requirements.lock` is the reviewed, exact version lock for these bundled Python worker dependencies, including their transitive dependencies. The release gate verifies that both the development and packaged `site-packages` trees exactly match this lock. Adding or changing a Python package requires an explicit lock-file, inventory, and notice update before release.

The packaged Windows x64 worker interpreter is the official Python 3.11.9 embeddable distribution. Its version, source URL, executable checksum, architecture, and license are pinned in `lib/runtime/python-runtime-manifest.json`; the release gate verifies the executable checksum before packaging and after staging resources.

## Release requirement

The packaged application must include this notice, the machine-readable inventory, the GPL license text, and the `python-runtime` resource tree. The release gate verifies the source configuration and can verify a staged Electron `resources` directory after packaging.
