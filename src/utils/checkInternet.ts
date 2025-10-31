import https from 'https'

export default (): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      https.get('https://www.google.com/generate_204', (res) => {
        resolve(true);
      }).on('error', () => {
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}