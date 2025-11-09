const axios = require('axios');

module.exports = {
  password: '', // Add a password field, if needed

  async search(keyword) {
    const url = 'https://zi0.cc/api/fs/search';
    const data = {
      parent: '/',
      keywords: keyword,
      scope: 0,
      page: 1,
      per_page: 100,
      password: this.password || ''
    };

    try {
      const response = await axios.post(url, data);
      if (response.data && response.data.data && response.data.data.content) {
        const files = response.data.data.content.filter(item => !item.is_dir);
        files.forEach(item => {
          let path = item.parent;
          if (!path.endsWith('/')) {
            path += '/';
          }
          path += item.name;
          item.path = path;
        });
        return files;
      }
      return [];
    } catch (error) {
      return [];
    }
  },

  async getDownloadUrl(file) {
    try {
      const response = await axios.post('https://zi0.cc/api/fs/get', {
        path: file.path,
        password: this.password || '',
        fetch_dl_token: true
      });
      if (response.data && response.data.data && response.data.data.raw_url) {
        return response.data.data.raw_url;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
};