import {
  ColumnsList,
  Grist,
  RecordsWithoutFields,
  RecordsWithoutId,
  CreateFields,
  UpdateColumns,
  GetFields,
} from "./generated/index";
import { program } from "commander";
import assert from "node:assert";
program
  .requiredOption("-b, --bearer <bearer>", "the API key")
  .requiredOption("-s, --source <docId>", "the source document", "aW2PUNfpyxML")
  .requiredOption(
    "-d, --destination <destination>",
    "the destination document",
    "uWi6qdCTiKxB"
  );

program.parse();

const opts = program.opts();

const myGrist = new Grist({
  BASE: "http://localhost:8484/api",
  TOKEN: opts.bearer,
});
const idMap = new Map<number, number>();
const SOURCE_DOC = opts.source;
const DEST_DOC = opts.destination;

const columnListToMap = (list: ColumnsList) => {
  return new Map(list.columns?.map(({ id, fields }) => [id, fields]));
};

async function getColumnByRef(docId: string, tableId: string, ref: number) {
  const { columns } = await myGrist.columns.listColumns({
    docId,
    tableId,
  });
  console.log(
    "search = %i ; refs = %o",
    ref,
    columns?.map((col) => col.fields?.colRef)
  );
  return columns?.find((col) => col.fields?.colRef === ref);
}

async function getColumnById(docId: string, tableId: string, id: string) {
  const { columns } = await myGrist.columns.listColumns({
    docId,
    tableId,
  });
  return columns?.find((col) => col.id === id);
}

async function synchronize(tableName: string, requireField: string) {
  assert.notEqual(
    SOURCE_DOC,
    DEST_DOC,
    "!!! The source and the destination are equal"
  );

  const sourceColumns: ColumnsList = await myGrist.columns.listColumns({
    docId: SOURCE_DOC,
    tableId: tableName,
  });

  console.log("sourceColumns = %o", sourceColumns);

  const destColumns: ColumnsList = await myGrist.columns.listColumns({
    docId: DEST_DOC,
    tableId: tableName,
  });

  // const sourceColumnsMap = columnListToMap(sourceColumns);
  // const destColumnsMap = columnListToMap(destColumns);

  // const destColumnsToDelete = destColumns
  //   .columns!.filter((col) => !sourceColumnsMap.has(col.id))
  //   .map((col) => col.id);

  // const destColumnsToAdd = sourceColumns.columns!.filter(
  //   (col) => !destColumnsMap.has(col.id)
  // );

  const columnsToSend: UpdateColumns = {
    columns: await Promise.all(
      sourceColumns.columns!.map(async ({ id, fields }) => {
        const { ...createFields } = fields as { [index: string]: any };
        for (const prop of ["parentId", "colRef"]) {
          delete createFields![prop];
        }
        if (createFields.type?.startsWith("Ref")) {
          const table = createFields.type?.replace("Ref:", "");
          console.log("table = ", table);
          console.log("createFields.visibleCol = ", createFields.visibleCol);
          const visibleColId = (await getColumnByRef(
            SOURCE_DOC,
            table,
            createFields.visibleCol
          ))!.id!;
          createFields.visibleCol = (
            await getColumnById(DEST_DOC, table, visibleColId)
          )?.fields?.colRef;
          console.log("createFields.displayCol = ", createFields.displayCol);
          delete createFields.displayCol;
        }
        return {
          id: id!,
          fields: createFields as CreateFields,
        };
      })
    ),
  };

  await myGrist.columns.replaceColumns({
    docId: DEST_DOC,
    tableId: tableName,
    requestBody: columnsToSend,
    replaceall: true,
  });

  const sourceRecs = await myGrist.records.listRecords({
    tableId: tableName,
    docId: SOURCE_DOC,
  });
  console.log("sourceRecs = ", sourceRecs);

  // const recordsToPut: RecordsWithoutId["records"] = sourceRecs.records.map(
  //   (rec) => {
  //     const recToPut = {
  //       id: rec.id,
  //       fields: { ...rec.fields },
  //     };
  //     delete recToPut.fields.colRef;
  //     return rec;
  //   }
  // );
  // console.log("recordsToPut = ", recordsToPut);
  //
  const formulaColumnIds = sourceColumns
    .columns!.filter((col) => col.fields?.isFormula)
    .map((col) => col.id);

  const fieldsToOmit = new Set([...formulaColumnIds]);

  const recordsToPut = sourceRecs.records.map((rec) => {
    const { insee_reg, insee_dep, ...fields } = rec.fields;
    return {
      require: { [requireField]: rec.fields[requireField] },
      id: rec.id,
      fields: Object.fromEntries(
        Object.entries(fields).filter(([key]) => !fieldsToOmit.has(key))
      ),
    };
  });
  // console.log("recordsToPut = ", recordsToPut);

  // FIXME: records removed in the source should also be removed in the synchronized table
  const resReplace: any = await myGrist.records.replaceRecords({
    docId: DEST_DOC,
    tableId: tableName,
    requestBody: {
      records: recordsToPut,
    },
  });

  console.log("resReplace = ", resReplace);
}

interface SynchronizeParam {
  tableName: string;
  requireField: string;
}
async function main() {
  const toSynchronize: Array<SynchronizeParam> = [
    {
      tableName: "Regions",
      requireField: "insee_reg",
    },
    {
      tableName: "Departement",
      requireField: "insee_dep",
    },
    {
      tableName: "Epci",
      requireField: "siren_epci",
    },
    {
      tableName: "Communes2",
      requireField: "insee_com",
    },
  ];
  const { tables } = await myGrist.tables.listTables({ docId: DEST_DOC });
  for (const sync of toSynchronize) {
    try {
      if (!tables.some(({ id }) => id === sync.tableName)) {
        await myGrist.tables.addTables({
          docId: DEST_DOC,
          requestBody: {
            tables: [
              { id: sync.tableName, columns: [{ id: "dummy", fields: {} }] },
            ],
          },
        });
      }
      await synchronize(sync.tableName, sync.requireField);
    } catch (_e) {
      const e = _e as Error;
      console.error(e, e.stack);
      console.error("Cannot synchronize ", sync.tableName);
      throw e;
    }
  }
}

main();
