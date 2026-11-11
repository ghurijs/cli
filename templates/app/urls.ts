// URL patterns for the '{{name}}' app. Include them from src/urls.ts:
//   import { urlpatterns as {{camelName}}Urls } from './{{name}}/urls'
//   path('{{name}}/', include({{camelName}}Urls)),
import { path, urlpatterns as patterns } from '@ghuri/core'
import { index } from './views'

export const urlpatterns = patterns('{{name}}', [
  path('', index, { name: 'index' }),
])
