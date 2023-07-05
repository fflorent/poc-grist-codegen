import { Grist, RecordsWithoutFields, RecordsWithoutId } from "./generated/index"
import { program } from "commander";

program
  .requiredOption('-b, --bearer <bearer>', 'the API key')
  .requiredOption('-t, --tableId <tableId>', 'the table ID')
  .requiredOption('-d, --docId <docId>', 'the document ID')
  .option('-u, --apiUrl <url>', 'The URL of the API', 'http://localhost:8484/api')
  .option('--recordToAdd <json>', 'If set, the program will not list the content table and instead insert a record using the passed data.');

program.parse();
const opts = program.opts();

const myGrist = new Grist({
  BASE: 'http://localhost:8484/api',
  TOKEN: opts.bearer,
});

export async function listRecords() {

  const result = await myGrist.records.listRecords({tableId: opts.tableId, docId: opts.docId});

  console.table(result.records.map(rec => rec.fields));
}

export async function addRecord(fields: object) {
  const records: RecordsWithoutId = {
    records: [
      {
        fields
      }
    ]
  };

  return myGrist.records.addRecords({
    tableId: opts.tableId,
    docId: opts.docId,
    requestBody: records
  });
}

if (require.main === module) {
  if (!opts.recordToAdd) {
    listRecords();
  } else {
    addRecord(JSON.parse(opts.recordToAdd)).then((rec: RecordsWithoutFields) => {
      console.log("Record added successfully with ID %d", rec.records[0].id);
    });

  }
}
