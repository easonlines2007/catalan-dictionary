# Català — Diccionario de bolsillo

[English](README.md) · [中文](README.zh-CN.md) · Español

Vine a Barcelona a estudiar, pero mi catalán deja bastante que desear, así que
hice un diccionario de catalán, chino y español para apañármelas. ¡Usadlo libremente!

Un diccionario para el móvil con búsqueda de formas, pronunciación, favoritos
y acceso sin conexión. Incluye unas 97.000 entradas en catalán; las traducciones
al chino cubren por ahora una pequeña selección revisada.

## Abrir y buscar

[Abre el diccionario](https://catalan-dictionary-pwa.vercel.app) en el navegador.
Para usarlo con conexión no hace falta registrarse, iniciar sesión ni descargar software.

<img src="docs/images/home.jpg" width="320" alt="Pantalla inicial con el buscador de catalán y algunas palabras sugeridas">

*Inicio: buscador arriba; Cerca y Desats abajo.*

1. Escribe una palabra o una forma en **catalán** en el buscador.
2. Pulsa **Enter** o toca **→**. Prueba `pujant`: la aplicación encuentra `pujar`.
3. Consulta los significados, ejemplos e información gramatical disponibles.
   Si aparecen **Altres coincidències possibles**, toca otra coincidencia para verla.

<img src="docs/images/lookup.jpg" width="280" alt="Búsqueda que relaciona pujant con pujar y muestra el botón de pronunciación">
<img src="docs/images/lookup-details.jpg" width="280" alt="Significados en catalán, chino y español y ejemplos al desplazarse por el resultado de pujar">

*pujant → pujar. Desplázate para ver traducciones, ejemplos y el botón de guardar.*

La búsqueda parte del catalán. No permite buscar a la inversa desde el chino
o el español ni traduce frases completas. No todas las entradas incluyen los
tres idiomas, transcripción fonética o ejemplos; algunas muestran definiciones
en catalán o, cuando faltan otros significados, en inglés.

Escribe los acentos siempre que puedas. Por ejemplo, `coneixer` sugiere `conèixer`;
toca la sugerencia para abrirla. Las sugerencias ayudan con algunos errores,
pero si no encuentras una palabra, prueba otra grafía o su forma de diccionario.

## Escuchar, guardar y volver a consultar

- Toca **🔊** para escuchar la palabra con la voz del navegador o del sistema.
  Puede que tengas que descargar una voz catalana en los ajustes del dispositivo.
  La calidad y la reproducción sin conexión dependen del dispositivo y de la voz.
- Toca **☆ Desa** para guardar una palabra; el botón pasa a **★ Desat**.
- Abre **Desats** en la parte inferior para ver los favoritos. Toca una palabra
  para consultarla o su estrella para quitarla de la lista.
- Toca **Cerca** para volver al inicio. **Recent** muestra las búsquedas recientes
  con resultado; toca una para repetirla. **Esborra** borra solamente el historial.

<img src="docs/images/saved.jpg" width="320" alt="Pantalla Desats con palabras guardadas y sus traducciones disponibles">

*Los favoritos se guardan en este navegador y en este dispositivo.*

No hay sincronización entre dispositivos ni exportación integrada. Los favoritos,
el historial y los datos descargados son locales. Borrar los datos del sitio
o usar navegación privada puede eliminarlos o impedir que se guarden. Guardar
una palabra no sustituye la descarga completa: abrirla vuelve a ejecutar la búsqueda.

## Preparar el uso sin conexión

Abre la aplicación **con conexión** y espera a que termine la preparación inicial.
El vocabulario esencial contiene unas 5.000 entradas; el resto se carga al buscar
con conexión. Para descargar el diccionario completo:

1. Vuelve a **Cerca** y busca **Desa tot per usar-lo sense connexió**.
   En la versión pública actual, si el historial oculta el botón, toca primero
   **Esborra**. Esto borra las búsquedas recientes, pero conserva los favoritos.
2. Toca el botón y deja la página abierta. El diccionario comprimido ocupa unos
   **15 MB**; reserva espacio adicional para la aplicación y sus datos.
3. Espera a que aparezca **Diccionari complet desat** antes de desconectarte.
4. Si la descarga se interrumpe, vuelve a conectarte y toca el botón otra vez;
   se reutilizarán las partes que ya se hayan guardado.

<img src="docs/images/offline.jpg" width="320" alt="Preparación sin conexión con el diccionario completo guardado en el dispositivo">

*“Diccionari complet desat” indica que la descarga completa ha terminado.*

El uso sin conexión requiere haber preparado la aplicación y sus datos en el
mismo navegador. El navegador puede borrar datos almacenados; compruébalo antes
de depender del diccionario en un viaje. Si cambia la versión de los datos,
abre la aplicación con conexión y descarga de nuevo el diccionario completo.

## Añadir a la pantalla de inicio

- **iPhone/iPad:** Safari → Compartir → Añadir a la pantalla de inicio → Añadir.
  Si aparece **Abrir como app web**, deja activada la opción.
- **Chrome en Android:** menú junto a la barra de direcciones → Instalar y crear
  acceso directo → Instalar; sigue las instrucciones.
- **Chrome en el ordenador:** icono de instalación de la barra de direcciones,
  o menú → Enviar, guardar y compartir → Instalar página como aplicación.

Los nombres y las opciones cambian según el navegador y el sistema. Instalar
la aplicación es opcional y no descarga automáticamente el diccionario completo.
Consulta las guías oficiales de [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios),
[Chrome en Android](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=es)
y [Chrome en el ordenador](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=es).

## Si algo falla

Usa un navegador reciente. Si no carga una entrada, conecta y actualiza la página;
si falta una palabra, revisa los acentos o prueba el lema. Si no puedes guardar o descargar,
comprueba el espacio libre y evita la navegación privada. Si no se oye la pronunciación,
comprueba las voces instaladas.
[Comunica un problema](https://github.com/easonlines2007/catalan-dictionary/issues)
indicando navegador, dispositivo y palabra buscada; evita publicar datos personales.

## Uso local

Con **Node.js 22**:

```bash
git clone https://github.com/easonlines2007/catalan-dictionary.git
cd catalan-dictionary
npm ci
npm run dev
```

Abre [localhost:3000](http://localhost:3000). Para comprobar el modo de producción,
detén el servidor de desarrollo, ejecuta `npm run build` y después `npm start`.
La caché sin conexión se activa en producción; usa este modo para probar la reapertura sin conexión.

Comprobaciones: `npm test`, `npm run lint` y `npm run typecheck`.

Código de la aplicación: [MIT](LICENSE). Los datos conservan sus licencias:
[fuentes y atribución](DATA_SOURCES.md). [Privacidad](PRIVACY.md).
