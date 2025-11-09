const axios = require('axios');
const cheerio = require('cheerio');

module.exports = {
  baseUrl: 'https://lzacg.cc',
  oddBaseUrl: 'https://odd.lzacg.one',
  ossBaseUrl: 'https://oss.lzacg.one',
  cfClearanceCookie: 'QEfA1smti5EvFHRy9VIucUKAgkDnoKofkL9BkRvRzt0-1762604544-1.2.1.1-nu_hEgHhpfeDyePYtGnVjHVasZhOuSISRtiTyqCjmeSTqdPTnLcNetTw9pDvjJKmd0VF_ntqNLBobAyGO6JcB4Tu1XgY7RK8E8Fx1eH2dkSvBrEio8faH_ftw7Rfx8RqxnMRxQdLoLES8d9kG_Jc2pT6EvfPxvN2cTi7jcFaRjcjrXvOZIW6z_.lfxXVKwnk6Sq6IMdyVKA5naav2fTaSCWsc2LGQsX.WuaNMUCygwU', // Placeholder for cf_clearance cookie

  async search(keyword) {
    try {
      const url = `${this.baseUrl}/?s=${encodeURIComponent(keyword)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'Cookie': `cf_clearance=${this.cfClearanceCookie}`,
        },
      });
      const $ = cheerio.load(response.data);
      const results = [];
      $('.posts-item').each((i, el) => {
        const title = $(el).find('.item-heading a').text().trim();
        const link = $(el).find('.item-heading a').attr('href');
        if (title && link) {
          results.push({
            name: title,
            link: link,
            id: link.split('/').pop(),
          });
        }
      });
      return { data: { content: results } };
    } catch (error) {
      return { data: { content: [] } };
    }
  },

  async getDownloadUrl(item) {
    try {
      const detailUrl = item.link;
      const detailResponse = await axios.get(detailUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          'Cookie': `cf_clearance=${this.cfClearanceCookie}`,
        },
      });
      const $detail = cheerio.load(detailResponse.data);

      const downloadPageLink = $detail('a.wp-block-button__link').attr('href');
      if (!downloadPageLink) {
        throw new Error('Download page link not found.');
      }

      const alistPath = decodeURIComponent(new URL(downloadPageLink).pathname);
      const alistApiUrl = `${this.oddBaseUrl}/api/fs/list`;
      const alistResponse = await axios.post(alistApiUrl, { path: alistPath });

      if (alistResponse.data && alistResponse.data.data && alistResponse.data.data.content) {
          const downloadLinks = await Promise.all(alistResponse.data.data.content.map(async file => {
          if (file.is_dir) {
            return null;
          } else if (file.raw_url) {
            return { name: file.name, url: file.raw_url };
          } else {
            const getFileApiUrl = `${this.oddBaseUrl}/api/fs/get`;
            const getFileResponse = await axios.post(getFileApiUrl, {
              path: `${alistPath}/${file.name}`,
              password: '',
            });
            if (getFileResponse.data && getFileResponse.data.data && getFileResponse.data.data.raw_url) {
              return { name: file.name, url: getFileResponse.data.data.raw_url };
            } else {
              return null;
            }
          }
        }));
        return downloadLinks.filter(link => link !== null);
      } else {
        throw new Error('No content found in AList API response.');
      }
    } catch (error) {
      return [];
    }
  },
};