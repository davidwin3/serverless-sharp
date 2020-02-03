/**
 * This file should be restricted to dimensional size alterations to the image
 */

const sharp = require('sharp')
const smartcrop = require('smartcrop-sharp')

const NotImplementedException = require('../errors/NotImplementedException')

/**
 * Apply all supported size operations
 * @param image
 * @param edits
 * @return {Promise<void>}
 */
exports.apply = async (image, edits) => {
  await this.beforeApply(image, edits)

  const { w, h, fit, crop } = edits
  // The first thing we need to do is apply edits that affect the requested output size.
  if (w.processedValue || h.processedValue) {
    switch (fit.processedValue) {
      case 'clamp':
        // https://github.com/venveo/serverless-sharp/issues/26
        // Should extends the edge pixels outwards to match the given dimensions.
        // Not currently possible in Sharp.
        throw new NotImplementedException()
      case 'fillmax':
        // https://github.com/venveo/serverless-sharp/issues/27
        // Should resize the image while preserving aspect ratio within the dimensions given.
        // If the width or height exceeds the available width and height, fill with solid color or blurred image
        // Should be partially possible in Sharp. Just not a priority
        throw new NotImplementedException()
      case 'max':
        this.scaleClip(image, w.processedValue, h.processedValue, false)
        break
      case 'min':
        await this.scaleCrop(image, w.processedValue, h.processedValue, crop.processedValue, edits['fp-x'].processedValue, edits['fp-y'].processedValue, false)
        break
      case 'fill':
        await this.fill(image, edits.fill.processedValue, w.processedValue, h.processedValue, edits['fill-color'].processedValue)
        break
      case 'scale':
        this.scale(image, w.processedValue, h.processedValue)
        break
      case 'crop':
        await this.scaleCrop(image, w.processedValue, h.processedValue, crop.processedValue, edits['fp-x'].processedValue, edits['fp-y'].processedValue, true)
        break
      case 'clip':
        this.scaleClip(image, w.processedValue, h.processedValue, true)
        break
    }
  }
}

/**
* @param {Sharp} image
* @param width
* @param height
* @returns {*}
*/
exports.scaleMax = (image, width = null, height = null) => {
  image.resize({
    width,
    height,
    withoutEnlargement: true,
    fit: sharp.fit.inside
  })
}

/**
 *
 * @param {Sharp} image
 * @param width
 * @param height
 * @returns {*}
 */
exports.scaleClip = (image, width = null, height = null) => {
  image.resize({
    width,
    height,
    withoutEnlargement: false,
    fit: sharp.fit.inside
  })
}

/**
 *
 * @param {Sharp} image
 * @param width
 * @param height
 * @param color
 * @returns {*}
 */
exports.fill = async (image, mode, width = null, height = null, color = null) => {
  const resizeParams = {
    withoutEnlargement: false,
    fit: sharp.fit.contain
  }
  if (width) {
    resizeParams.width = width
  }
  if (height) {
    resizeParams.height = height
  }
  // TODO: Validate color more explicitly
  if (color) {
    resizeParams.background = color
  }
  image.resize(resizeParams)
}

/**
 * Stretch an image to fit the dimensions requested
 * @param {Sharp} image
 * @param width
 * @param height
 * @returns {*}
 */
exports.scale = (image, width, height) => {
  image.resize({
    width,
    height,
    withoutEnlargement: true,
    fit: sharp.fit.fill
  })
}

/**
 * Handle cropping modes
 * @param {Sharp} image
 * @param width
 * @param height
 * @param crop
 * @param fpx
 * @param fpy
 * @returns {*}
 */
exports.scaleCrop = async (image, width = null, height = null, crop = null, fpx = null, fpy = null) => {
  // top, bottom, left, right, faces, focalpoint, edges, and entropy
  // TODO: This should happen in the schemaParser
  if (!Array.isArray(crop)) {
    crop = []
  }

  // First we'll handle entropy mode - this one is simpler
  if (crop.includes('entropy')) {
    image.resize({
      width,
      height,
      withoutEnlargement: false,
      fit: sharp.fit.cover,
      position: sharp.strategy.entropy
    })
    return
  }

  // Now handle focalpoint, and left, right, top, bottom
  // extract metadata from image to resize
  const metadata = await image.metadata()

  const originalWidth = parseFloat(metadata.width)
  const originalHeight = parseFloat(metadata.height)

  const ratio = originalWidth / originalHeight

  if (width && !height) {
    height = width / ratio
  }
  if (height && !width) {
    width = height * ratio
  }

  // compute new width & height
  const factor = Math.max(width / originalWidth, height / originalHeight)
  const newWidth = parseInt(originalWidth * factor)
  const newHeight = parseInt(originalHeight * factor)

  if (crop.length && crop[0] === 'smart') {
    await this.smartCrop(image, width, height)
  } else {
    // if we don't have a focal point, default to center-center
    if (crop.length && crop[0] !== 'focalpoint') {
      fpx = 0.5
      fpy = 0.5
  
      // use position arguments to set focal point, if provided
      if (crop.includes('left')) {
        fpx = 0
      } else if (crop.includes('right')) {
        fpx = 1
      }
      if (crop.includes('top')) {
        fpy = 0
      } else if (crop.includes('bottom')) {
        fpy = 1
      }
    }
  
    let fpxLeft = Math.floor((newWidth * fpx) - (0.5 * width))
    let fpyTop = Math.floor((newHeight * fpy) - (0.5 * height))
  
    // ensure extracted region doesn't exceed image bounds
    if (width > newWidth) {
      width = newWidth
    }
    if (height > newHeight) {
      height = newHeight
    }
  
    // adjust focal point x
    if (fpxLeft + width > newWidth) {
      fpxLeft = newWidth - width
    } else if (fpxLeft < 0) {
      fpxLeft = 0
    }
  
    // adjust focal point y
    if (fpyTop + height > newHeight) {
      fpyTop = newHeight - height
    } else if (fpyTop < 0) {
      fpyTop = 0
    }
    image.resize({
      width: newWidth,
      height: newHeight,
      withoutEnlargement: false,
      fit: sharp.fit.fill
    }).extract({
      left: fpxLeft,
      top: fpyTop,
      width,
      height
    })
  }

}

exports.smartCrop = async function (image, width = null, height = null) {
  const buffer = await image.toBuffer()
  const smartResult = await smartcrop.crop(buffer, { width, height })
  if (smartResult) {
    const { topCrop } = smartResult
    image.extract({ 
      width: topCrop.width, 
      height: topCrop.height, 
      left: topCrop.x, 
      top: topCrop.y 
    }).resize(width, height)
  }
}

/**
 * We'll do any pre-work here
 * @param image
 * @param edits
 */
exports.beforeApply = async function (image, edits) {
  const { w, h, dpr, ar } = edits

  // Apply aspect ratio edits

  // Case 1: We have one dimension set
  if (ar.processedValue && ((w.processedValue && !h.processedValue) || (h.processedValue && !w.processedValue))) {
    if (w.processedValue) {
      h.processedValue = parseInt(w.processedValue * ar.processedValue)
    }
    if (h.processedValue) {
      w.processedValue = parseInt(h.processedValue / ar.processedValue)
    }
  }

  // Case 2: We don't have dimensions set, so we need to look at the original image dimensions
  if (ar.processedValue && ((!w.processedValue && !h.processedValue))) {
    const metadata = await image.metadata()

    const originalWidth = parseInt(metadata.width)
    const originalHeight = parseInt(metadata.height)

    h.processedValue = originalHeight * ar.processedValue
    w.processedValue = originalWidth * ar.processedValue
  }

  // Apply dpr edits
  if ((w.processedValue || h.processedValue) && dpr.processedValue) {
    if (w.processedValue) {
      w.processedValue *= dpr.processedValue
    }
    if (h.processedValue) {
      h.processedValue *= dpr.processedValue
    }
  }
}
