#!/bin/bash

set -euxo pipefail

curl https://raw.githubusercontent.com/gristlabs/grist-help/master/api/grist.yml > grist.yml

npm exec openapi -- --input ./grist.yml --output ./generated --client node --name Grist --useOptions
