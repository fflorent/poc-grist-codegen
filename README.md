# POC for a Typescript Grist client

This is a POC for a Typescript Grist API client.

It uses [openapi-typescript-codegen](https://github.com/ferdikoomen/openapi-typescript-codegen) to generate the API client and the [OpenAPI documentation of Grist](https://support.getgrist.com/api/) ([source code](https://github.com/gristlabs/grist-help/blob/master/api/grist.yml)).

## What should I look at?

What interest us is the process that generates the client (`./generate_client.sh`) and also the use of the client (`./cli-sample.ts`).

## Quick start for the POC demo

Just run the following commands:
```bash
$ npm install
$ npm run generate-client
$ ts-node ./cli-sample.ts --help
```

To list the content of a table:
```bash
$ ts-node ./cli-sample.ts -b BEARER -d DOC_ID -t TABLE_ID -u http://localhost:8484/api
```

To insert a record (replace the JSON by whatever you want to insert in the given table):
```bash
$ ts-node ./cli-sample.ts -b BEARER -d DOC_ID -t TABLE_ID -u http://localhost:8484/api --recordToAdd '{"Name": "Some-Name", "Email": "foo@example.org"}'
```

## How does this work?

Openapi-typescript-codegen parses the content of the yaml file and generates a client and the models to pass to the Client so it can handle the requests.
