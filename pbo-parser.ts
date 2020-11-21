import * as fs from 'fs';
import * as _ from 'lodash';

const archive = fs.readFileSync(
  'C:\\SteamLibrary\\steamapps\\common\\Arma 3\\MPMissions\\base_defense.Tanoa.pbo',
);

const files = [];

class HeaderEntry {
  public fileName: string;
  public packingMethod: number;
  public originalSize: number;
  public timeStamp: number;
  public dataSize: number;
  public data: any;

  constructor({ fileName, packingMethod, originalSize, timeStamp, dataSize }) {
    this.fileName = fileName;
    this.packingMethod = packingMethod;
    this.originalSize = originalSize;
    this.timeStamp = timeStamp;
    this.dataSize = dataSize;
    this.data = null;
  }

  toBuffer() {
    const offset = this.fileName.length;

    const headerEntry = Buffer.alloc(offset + 21);

    headerEntry.write(this.fileName);

    headerEntry.writeInt32LE(this.packingMethod, offset + 1 + 4);
    headerEntry.writeInt32LE(this.originalSize, offset + 1 + 8);
    headerEntry.writeInt32LE(this.timeStamp, offset + 1 + 12);
    headerEntry.writeInt32LE(this.dataSize, offset + 1 + 16);

    return headerEntry;
  }
}

let cursor = 0;

while (true) {
  let fileNamePos = archive.indexOf(0x00, cursor);

  const fileNameLength = fileNamePos - cursor;

  const fileName = archive.toString('utf-8', cursor, fileNamePos);

  const packingMethod = archive.readInt32LE(fileNamePos + 1 + 4);
  const originalSize = archive.readInt32LE(fileNamePos + 1 + 8);
  const timeStamp = archive.readInt32LE(fileNamePos + 1 + 12);
  const dataSize = archive.readInt32LE(fileNamePos + 1 + 16);

  const headerEntry = new HeaderEntry({
    fileName,
    packingMethod,
    originalSize,
    timeStamp,
    dataSize,
  });

  console.log('filename', headerEntry.fileName);

  cursor += fileNameLength + 21;

  files.push(headerEntry);

  if (fileNameLength === 0) {
    break;
  }
}

const headerEnd = cursor;

let posInFile = 0;

_.forEach(files, (file) => {
  file.data = archive.slice(
    headerEnd + posInFile,
    headerEnd + posInFile + file.dataSize,
  );

  posInFile += file.dataSize;
});

const missionSqm = _.find(files, ['fileName', 'mission.sqm']);

if (!missionSqm) throw new Error('mission.sqm not found.');

console.log(missionSqm);

//console.log(missionSqm.data.toString('utf-8'));

cursor = headerEnd + posInFile;

const footer = archive.slice(cursor);

const headerEntries = [];

_.forEach(files, (file) => {
  headerEntries.push(file.toBuffer());
});

_.forEach(files, (file) => {
  headerEntries.push(file.data);
});

headerEntries.push(footer);

fs.writeFileSync('mission.pbo', Buffer.concat(headerEntries));
