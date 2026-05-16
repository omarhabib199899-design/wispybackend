let S3Client, PutObjectCommand, DeleteObjectCommand;
try {
  ({ S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3'));
} catch (_) {}

const isConfigured = () =>
  S3Client && process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET_NAME;

const getClient = () => new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

exports.uploadFile = async (buffer, key, mimeType = 'application/octet-stream') => {
  if (!isConfigured()) {
    console.warn('S3 not configured — file not stored');
    return null;
  }
  await getClient().send(new PutObjectCommand({
    Bucket:      process.env.S3_BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));
  return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
};

exports.deleteFile = async (urlOrKey) => {
  if (!isConfigured() || !urlOrKey) return;
  try {
    const key = urlOrKey.includes('amazonaws.com/') ? urlOrKey.split('amazonaws.com/')[1] : urlOrKey;
    await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
  } catch (err) {
    console.error('S3 delete error:', err.message);
  }
};
