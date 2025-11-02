const axios = require('axios');

async function search(keyword) {
  const url = 'https://zi0.cc/api/fs/search';
  const data = {
    parent: '/',
    keywords: keyword,
    scope: 0,
    page: 1,
    per_page: 100,
    password: ''
  };

  try {
    const response = await axios.post(url, data);
    if (response.data && response.data.data && response.data.data.content) {
      response.data.data.content.forEach(item => {
        let path = item.parent;
        if (!path.endsWith('/')) {
          path += '/';
        }
        path += item.name;
        item.path = path;
      });
    }
    return response.data;
  } catch (error) {
    console.error('Error searching:', error);
    return null;
  }
}

module.exports = {
  search
};