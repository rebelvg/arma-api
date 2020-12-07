import express from 'express';
import fs from 'fs';
import _ from 'lodash';
import md5 from 'md5';
import moment from 'moment';
import path from 'path';
import { promisify } from 'util';
import sanitizeFilename from 'sanitize-filename';

const VERIFY_DIR_PATH = path.resolve('verify');
const MISSIONS_DIR_PATH = path.resolve('missions');
const MD5_DIR_PATH = path.resolve('md5');

for (const dirPath of [VERIFY_DIR_PATH, MISSIONS_DIR_PATH, MD5_DIR_PATH]) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
}

import { MAX_FILE_SIZE_MB, PORT, UPLOAD_TOKEN, VERIFY_CHECK } from './config';

const app = express();

app.set('trust proxy', true);

const router = express.Router();

class Mission {
  public missionName: string;
  public islandName: string;

  constructor(fileName) {
    const missionName = fileName.split('.');

    if (missionName.length !== 2) {
      throw new Error('bad_name: Example - mission_name.island.pbo');
    }

    this.missionName = _.first(missionName);
    this.islandName = _.last(missionName);
  }
}

router.post('/verify/:group', (req, res) => {
  const groupName = req.params.group;
  const groupPassword = _.get(req.headers, 'auth');
  const hash = _.get(req.headers, 'hash') as string;

  const groupObj = _.find(VERIFY_CHECK, { name: groupName });

  if (!groupObj) {
    throw new Error('bad_group_name');
  }

  if (groupObj.password !== groupPassword) {
    throw new Error('bad_auth');
  }

  if (!hash) {
    throw new Error('no_hash');
  }

  const filePath = path.resolve(VERIFY_DIR_PATH, sanitizeFilename(groupName));

  fs.writeFile(filePath, hash, () => {
    res.send(null);
  });
});

router.get('/verify/:group', (req, res, next) => {
  const groupName = req.params.group;

  const groupObj = _.find(VERIFY_CHECK, { name: groupName });

  if (!groupObj) {
    throw new Error('bad_group_name');
  }

  const filePath = path.resolve(VERIFY_DIR_PATH, sanitizeFilename(groupName));

  fs.readFile(
    filePath,
    {
      encoding: 'utf8',
    },
    (err, file) => {
      if (err) return next(err);

      res.send(file);
    },
  );
});

router.post('/missions', async (req, res, next) => {
  const uploadToken = _.get(req.headers, 'auth');
  const fileSize = parseInt(_.get(req.headers, 'content-length', '0'));
  let fileName = _.get(req.headers, 'filename') as string;

  try {
    if (uploadToken !== UPLOAD_TOKEN) {
      throw new Error('bad_auth');
    }

    if (fileSize === 0) {
      throw new Error('empty_file');
    }

    if (fileSize > MAX_FILE_SIZE_MB * 1024 * 1024) {
      throw new Error('size_too_large');
    }

    if (!fileName) {
      throw new Error('no_filename');
    }

    fileName = fileName.toLowerCase().replace(' ', '_');

    if (fileName !== encodeURIComponent(fileName)) {
      throw new Error('bad_filename_remove_special_chars');
    }

    const mission = new Mission(fileName);

    const files = await promisify(fs.readdir)('missions');

    await Promise.all(
      files
        .filter((fileName) =>
          new RegExp(`klpq_${mission.missionName}-\\d+_\\d+..+.pbo`).test(
            fileName,
          ),
        )
        .map((fileName) => promisify(fs.unlink)(`missions/${fileName}`)),
    );

    const newMissionName = `klpq_${mission.missionName}-${moment().format(
      'YYYYMMDD_HHmmss',
    )}.${mission.islandName}.pbo`;

    try {
      const missionBuffer = await new Promise<Buffer>((resolve, reject) => {
        const missionBuffers = [];

        req.on('data', (data) => {
          missionBuffers.push(data);
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.on('end', () => {
          const missionBuffer = Buffer.concat(missionBuffers);

          resolve(missionBuffer);
        });
      });

      const md5FilePath = path.resolve(
        MD5_DIR_PATH,
        sanitizeFilename(newMissionName),
      );

      await promisify(fs.writeFile)(md5FilePath, md5(missionBuffer));

      const missionFilePath = path.resolve(
        MISSIONS_DIR_PATH,
        sanitizeFilename(newMissionName),
      );

      await promisify(fs.writeFile)(missionFilePath, missionBuffer);
    } catch (error) {
      console.error(error);

      req.destroy();

      return;
    }

    res.send(null);
  } catch (e) {
    next(e);
  }
});

router.get('/missions', async (req, res, next) => {
  try {
    const files = await promisify(fs.readdir)('missions');

    const filesRes = await Promise.all(
      files.map(async (file) => {
        const hash = await promisify(fs.readFile)(`md5/${file}`, 'utf-8');

        return {
          file,
          hash,
        };
      }),
    );

    res.json(filesRes);
  } catch (e) {
    next(e);
  }
});

router.get('/missions/:missionName', (req, res, next) => {
  const missionName = req.params.missionName;

  const filePath = path.resolve(
    MISSIONS_DIR_PATH,
    sanitizeFilename(missionName),
  );

  res.sendFile(filePath);
});

app.use(router);

app.use((req, res, next) => {
  throw new Error('not_found');
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.stack.split('\n') });
});

//remove previous unix socket
if (typeof PORT === 'string') {
  if (fs.existsSync(PORT)) {
    fs.unlinkSync(PORT);
  }
}

app.listen(PORT, () => {
  console.log('server_running');

  //set unix socket rw rights for nginx
  if (typeof PORT === 'string') {
    fs.chmodSync(PORT, '777');
  }
});
