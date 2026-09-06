import { config, collection, fields } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },

  collections: {
    posts: collection({
      label: 'Երազներ',
      slugField: 'title',
      path: 'src/data/posts/*',
      format: { data: 'json' },
      schema: {
        title: fields.slug({ name: { label: 'Վերնագիր' } }),
        slug: fields.text({
          label: 'Адрес поста (slug)',
          description: 'Например: erazahan-ax. Если оставить пустым — адрес выведется из источника.',
        }),
        date: fields.date({ label: 'Ամսաթիվ' }),
        letter: fields.text({ label: 'Տառ' }),
        description: fields.text({
          label: 'SEO նկարագրություն',
          description: 'Կարճ նկարագրություն որոնման արդյունքների համար (մինչև 160 նշան)',
          multiline: true,
        }),
        cover: fields.image({
          label: 'Обложка',
          directory: 'public/uploads',
          publicPath: '/uploads/',
        }),
        categories: fields.array(fields.text({ label: 'Կատեգորիա' }), { label: 'Կատեգորիաներ' }),
        content: fields.text({ label: 'Բովանդակություն', multiline: true }),
        sourceUrl: fields.url({ label: 'Աղբյուրի հղում' }),
        comments: fields.array(
          fields.object({
            id: fields.text({ label: 'ID' }),
            author: fields.text({ label: 'Հեղինակ' }),
            date: fields.text({ label: 'Ամսաթիվ' }),
            content: fields.text({ label: 'Բովանդակություն', multiline: true }),
            parent: fields.text({ label: 'Ծնող' }),
          }),
          { label: 'Մեկնաբանություններ' },
        ),
      },
    }),
  },
});