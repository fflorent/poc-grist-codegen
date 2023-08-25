import {
  ColumnsList,
  Grist,
  CreateFields,
  UpdateColumns,
  Fields,
  RecordsList,
} from "./generated/index";
import { program } from "commander";
import assert from "node:assert";
import fetch from "node-fetch";

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

const baseApiUrl = "http://localhost:8484/api";

const myGrist = new Grist({
  BASE: baseApiUrl,
  TOKEN: opts.bearer,
});
const SOURCE_DOC = opts.source;
const DEST_DOC = opts.destination;

async function getColumnByRef(docId: string, tableId: string, ref: number) {
  const { columns } = await myGrist.columns.listColumns({
    docId,
    tableId,
    hidden: true,
  });
  return columns?.find((col) => col.fields?.colRef === ref);
}

async function getColumnById(docId: string, tableId: string, id: string) {
  const { columns } = await myGrist.columns.listColumns({
    docId,
    tableId,
    hidden: true,
  });
  return columns?.find((col) => col.id === id);
}

class SourceIdLookup {
  private constructor(private map: Map<string, Map<number, number>>) {}

  get(table: string, sourceId: number) {
    return this.map.get(table)!.get(sourceId)!;
  }

  dump(record: RecordsList["records"][0]) {
    const res = Object.fromEntries(
      [...this.map.entries()].map(([colId, map]) => {
        return [colId, map.get(record.fields[colId])];
      })
    );
    // console.log("res = ", res);
    return res;
  }

  static async build(columns: ColumnsList, sourceDoc: string, destDoc: string) {
    const map = new Map<string, Map<number, number>>();
    const referencesColumns = columns.columns!.filter(
      (col) => col.fields?.type?.startsWith("Ref:") && !col.fields?.isFormula
    );
    const referencedTablesByColId = new Map(
      referencesColumns.map((col) => [
        col.id,
        col.fields!.type!.replace("Ref:", ""),
      ])
    );
    const uniqueReferencedTable = [
      ...new Set(referencedTablesByColId.values()),
    ];
    for (const table of uniqueReferencedTable) {
      const { records } = await myGrist.records.listRecords({
        docId: destDoc,
        tableId: table,
        hidden: true,
      });
      const idBySourceId = new Map(
        records.map((rec) => [rec.fields.gristHelper_sourceId, rec.id])
      );
      map.set(table, idBySourceId);
    }
    return new SourceIdLookup(
      new Map(
        referencesColumns.map((col) => [
          col.id!,
          map.get(referencedTablesByColId.get(col.id)!)!,
        ])
      )
    );
  }
}

async function synchronize(tableName: string) {
  assert.notEqual(
    SOURCE_DOC,
    DEST_DOC,
    "!!! The source and the destination are equal"
  );

  const sourceColumns: ColumnsList = await myGrist.columns.listColumns({
    docId: SOURCE_DOC,
    tableId: tableName,
    hidden: true,
  });

  const columnsToSend: UpdateColumns = {
    columns: [
      ...(await Promise.all(
        sourceColumns.columns!.map(async ({ id, fields }) => {
          const { ...createFields } = fields as { [index: string]: any };
          for (const prop of ["parentId", "colRef"]) {
            delete createFields![prop];
          }
          if (createFields.type?.startsWith("Ref")) {
            const table = createFields.type?.replace("Ref:", "");
            const visibleColId = (await getColumnByRef(
              SOURCE_DOC,
              table,
              createFields.visibleCol
            ))!.id!;
            createFields.visibleCol = (
              await getColumnById(DEST_DOC, table, visibleColId)
            )?.fields?.colRef;
            const displayColId = (await getColumnByRef(
              SOURCE_DOC,
              tableName,
              createFields.displayCol
            ))!.id!;
            createFields.displayCol = (
              await getColumnById(DEST_DOC, tableName, displayColId)
            )?.fields?.colRef;
          }
          return {
            id: id!,
            fields: createFields as CreateFields,
          };
        })
      )),
      {
        id: "gristHelper_sourceId",
        fields: { type: Fields.type.NUMERIC },
      },
    ],
  };

  await myGrist.columns.replaceColumns({
    docId: DEST_DOC,
    tableId: tableName,
    requestBody: columnsToSend,
    replaceall: true,
  });

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

  await replaceRecords(tableName, sourceColumns);

  // console.log("recordsToPut = ", recordsToPut);

  // await myGrist.records.replaceRecords({
  //   docId: DEST_DOC,
  //   tableId: tableName,
  //   requestBody: {
  //     records: recordsToPut,
  //   },
  // });
}

async function replaceRecords(tableName: string, sourceColumns: ColumnsList) {
  const sourceRecs = await myGrist.records.listRecords({
    tableId: tableName,
    docId: SOURCE_DOC,
    hidden: true,
  });

  const formulaColumnIds = sourceColumns
    .columns!.filter((col) => col.fields?.isFormula)
    .map((col) => col.id);

  const sourceIdLookup = await SourceIdLookup.build(
    sourceColumns,
    SOURCE_DOC,
    DEST_DOC
  );
  const fieldsToOmit = new Set([...formulaColumnIds]);

  const destRecords = (
    await myGrist.records.listRecords({
      docId: DEST_DOC,
      tableId: tableName,
      hidden: true,
    })
  ).records!;
  const destColumns = (
    await myGrist.columns.listColumns({
      docId: DEST_DOC,
      tableId: tableName,
      hidden: true,
    })
  ).columns!;
  // const destColumnsById = new Map<string, any>(
  //   destColumns.map((col) => [col.id!, col.fields])
  // );
  const destRecordsBySourceId = new Map<number, RecordsList["records"][0]>(
    destRecords.map((rec) => [rec.fields.gristHelper_sourceId, rec])
  );

  const body = [
    [
      "ReplaceTableData",
      tableName,
      sourceRecs.records.map(
        (rec) => destRecordsBySourceId.get(rec.id)?.id ?? null
      ),
      {
        ...Object.fromEntries(
          sourceColumns.columns!.map(({ id: colId }) => {
            return [
              colId,
              sourceRecs.records!.map((rec) => rec.fields[colId!]),
            ];
          })
        ),
        gristHelper_sourceId: sourceRecs.records.map((rec) => rec.id),
        // FIXME sourceIdLookup.dump
      },
    ],
  ];
  console.log("body = ", JSON.stringify(body, null, 4));
  const res = await fetch(`${baseApiUrl}/docs/${DEST_DOC}/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.bearer}`,
    },
    body: JSON.stringify(body), // TODO
  });
  console.log("await res.json() = ", await res.json());
}

async function main() {
  const tablesToSync = ["Regions" /*, "Departement", "Epci" /*, "Communes2"*/];
  const { tables } = await myGrist.tables.listTables({ docId: DEST_DOC });
  for (const table of tablesToSync) {
    try {
      if (!tables.some(({ id }) => id === table)) {
        await myGrist.tables.addTables({
          docId: DEST_DOC,
          requestBody: {
            tables: [{ id: table, columns: [{ id: "dummy", fields: {} }] }],
          },
        });
      }
      await synchronize(table);
    } catch (_e) {
      const e = _e as Error;
      console.error(e, e.stack);
      console.error("Cannot synchronize ", table);
      throw e;
    }
  }
}

main();
