/*
 * Copyright 2007 ZXing authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Modified for Portal QrAnchor, 2026: detector returns measured finder geometry.
import { finderQuad } from './geometry.js';
import MathUtils from '@zxing/library/es2015/core/common/detector/MathUtils.js';
// import GridSampler from '@zxing/library/es2015/core/common/GridSampler.js';
import DecodeHintType from '@zxing/library/es2015/core/DecodeHintType.js';
import NotFoundException from '@zxing/library/es2015/core/NotFoundException.js';
import ResultPoint from '@zxing/library/es2015/core/ResultPoint.js';
import FinderPatternFinder from './FinderPatternFinder.js';
/*import java.util.Map;*/
/**
 * <p>Encapsulates logic that can detect a QR Code in an image, even if the QR Code
 * is rotated or skewed, or partially obscured.</p>
 *
 * @author Sean Owen
 */
export default class Detector {
    constructor(image,innerFinders=false) {
        this.image = image;
        this.innerFinders=innerFinders;
    }
    getImage() {
        return this.image;
    }
    getResultPointCallback() {
        return this.resultPointCallback;
    }
    /**
     * <p>Detects a QR Code in an image.</p>
     *
     * @return measured finder geometry for the Portal pose pipeline
     * @throws NotFoundException if QR Code cannot be found
     * @throws FormatException if a QR Code cannot be decoded
     */
    // public detect(): DetectorResult /*throws NotFoundException, FormatException*/ {
    //   return detect(null)
    // }
    /**
     * <p>Detects a QR Code in an image.</p>
     *
     * @param hints optional hints to detector
     * @return measured finder geometry for the Portal pose pipeline
     * @throws NotFoundException if QR Code cannot be found
     * @throws FormatException if a QR Code cannot be decoded
     */
    findPatterns(hints,diagnostics=null) {
        this.resultPointCallback = (hints === null || hints === undefined) ? null :
            /*(ResultPointCallback) */ hints.get(DecodeHintType.NEED_RESULT_POINT_CALLBACK);
        const finder = new FinderPatternFinder(this.image, this.resultPointCallback);
        try {
            const result=finder.find(hints);
            if(diagnostics) diagnostics.finderCount=3;
            return result;
        } finally {
            if(diagnostics) diagnostics.finderCandidates=Math.max(diagnostics.finderCandidates||0,finder.possibleCenters.length);
        }
    }
    detect(hints, knownDimension = null) {
        return this.processFinderPatternInfo(this.findPatterns(hints), knownDimension);
    }
    *detectCandidates(hints,diagnostics=null) {
        const info=this.findPatterns(hints,diagnostics);
        const points=[info.getTopLeft(),info.getTopRight(),info.getBottomLeft()];
        // At steep perspective the longest image-space side need not be the QR
        // diagonal. Try all three orientation-preserving corner assignments;
        // payload decoding decides which one is physically correct.
        for(let i=0;i<3;i++) {
            try {
                yield this.processFinderPatternInfo({
                    getTopLeft:()=>points[i],getTopRight:()=>points[(i+1)%3],getBottomLeft:()=>points[(i+2)%3],
                });
            } catch(error) {
                if(!(error instanceof NotFoundException)&&!/Finder/.test(error.message)) throw error;
            }
        }
    }
    processFinderPatternInfo(info, knownDimension = null) {
        const topLeft = info.getTopLeft();
        const topRight = info.getTopRight();
        const bottomLeft = info.getBottomLeft();
        const moduleSize = this.calculateModuleSize(topLeft, topRight, bottomLeft);
        if (!Number.isFinite(moduleSize) || moduleSize < 1.0) {
            throw new NotFoundException('No pattern found in proccess finder.');
        }
        const dimension = knownDimension ?? Detector.computeDimension(topLeft, topRight, bottomLeft, moduleSize);
        // Portal fork: measure all three finder outlines. ZXing's version-1
        // fallback invents the fourth point as a parallelogram, losing perspective.
        // These measured square corners give us 12 real image correspondences.
        const centers = [topLeft, topRight, bottomLeft].map(p => [p.getX(), p.getY()]);
        const quads = centers.map(center => finderQuad(this.image, center, moduleSize, centers,this.innerFinders));
        return { centers, quads, dimension };
    }
    /**
     * <p>Computes the dimension (number of modules on a size) of the QR Code based on the position
     * of the finder patterns and estimated module size.</p>
     */
    static computeDimension(topLeft, topRight, bottomLeft, moduleSize /*float*/) {
        const tltrCentersDimension = MathUtils.round(ResultPoint.distance(topLeft, topRight) / moduleSize);
        const tlblCentersDimension = MathUtils.round(ResultPoint.distance(topLeft, bottomLeft) / moduleSize);
        let dimension = Math.floor((tltrCentersDimension + tlblCentersDimension) / 2) + 7;
        switch (dimension & 0x03) { // mod 4
            case 0:
                dimension++;
                break;
            // 1? do nothing
            case 2:
                dimension--;
                break;
            case 3:
                // A perspective-biased size estimate is only a starting guess. The
                // core verifies nearby valid QR versions by decoding them.
                dimension += 2;
                break;
        }
        return dimension;
    }
    /**
     * <p>Computes an average estimated module size based on estimated derived from the positions
     * of the three finder patterns.</p>
     *
     * @param topLeft detected top-left finder pattern center
     * @param topRight detected top-right finder pattern center
     * @param bottomLeft detected bottom-left finder pattern center
     * @return estimated module size
     */
    calculateModuleSize(topLeft, topRight, bottomLeft) {
        // Take the average
        return (this.calculateModuleSizeOneWay(topLeft, topRight) +
            this.calculateModuleSizeOneWay(topLeft, bottomLeft)) / 2.0;
    }
    /**
     * <p>Estimates module size based on two finder patterns -- it uses
     * {@link #sizeOfBlackWhiteBlackRunBothWays(int, int, int, int)} to figure the
     * width of each, measuring along the axis between their centers.</p>
     */
    calculateModuleSizeOneWay(pattern, otherPattern) {
        const moduleSizeEst1 = this.sizeOfBlackWhiteBlackRunBothWays(/*(int) */ Math.floor(pattern.getX()), 
        /*(int) */ Math.floor(pattern.getY()), 
        /*(int) */ Math.floor(otherPattern.getX()), 
        /*(int) */ Math.floor(otherPattern.getY()));
        const moduleSizeEst2 = this.sizeOfBlackWhiteBlackRunBothWays(/*(int) */ Math.floor(otherPattern.getX()), 
        /*(int) */ Math.floor(otherPattern.getY()), 
        /*(int) */ Math.floor(pattern.getX()), 
        /*(int) */ Math.floor(pattern.getY()));
        if (isNaN(moduleSizeEst1)) {
            return moduleSizeEst2 / 7.0;
        }
        if (isNaN(moduleSizeEst2)) {
            return moduleSizeEst1 / 7.0;
        }
        // Average them, and divide by 7 since we've counted the width of 3 black modules,
        // and 1 white and 1 black module on either side. Ergo, divide sum by 14.
        return (moduleSizeEst1 + moduleSizeEst2) / 14.0;
    }
    /**
     * See {@link #sizeOfBlackWhiteBlackRun(int, int, int, int)}; computes the total width of
     * a finder pattern by looking for a black-white-black run from the center in the direction
     * of another point (another finder pattern center), and in the opposite direction too.
     */
    sizeOfBlackWhiteBlackRunBothWays(fromX /*int*/, fromY /*int*/, toX /*int*/, toY /*int*/) {
        let result = this.sizeOfBlackWhiteBlackRun(fromX, fromY, toX, toY);
        // Now count other way -- don't run off image though of course
        let scale = 1.0;
        let otherToX = fromX - (toX - fromX);
        if (otherToX < 0) {
            scale = fromX / /*(float) */ (fromX - otherToX);
            otherToX = 0;
        }
        else if (otherToX >= this.image.getWidth()) {
            scale = (this.image.getWidth() - 1 - fromX) / /*(float) */ (otherToX - fromX);
            otherToX = this.image.getWidth() - 1;
        }
        let otherToY = /*(int) */ Math.floor(fromY - (toY - fromY) * scale);
        scale = 1.0;
        if (otherToY < 0) {
            scale = fromY / /*(float) */ (fromY - otherToY);
            otherToY = 0;
        }
        else if (otherToY >= this.image.getHeight()) {
            scale = (this.image.getHeight() - 1 - fromY) / /*(float) */ (otherToY - fromY);
            otherToY = this.image.getHeight() - 1;
        }
        otherToX = /*(int) */ Math.floor(fromX + (otherToX - fromX) * scale);
        result += this.sizeOfBlackWhiteBlackRun(fromX, fromY, otherToX, otherToY);
        // Middle pixel is double-counted this way; subtract 1
        return result - 1.0;
    }
    /**
     * <p>This method traces a line from a point in the image, in the direction towards another point.
     * It begins in a black region, and keeps going until it finds white, then black, then white again.
     * It reports the distance from the start to this point.</p>
     *
     * <p>This is used when figuring out how wide a finder pattern is, when the finder pattern
     * may be skewed or rotated.</p>
     */
    sizeOfBlackWhiteBlackRun(fromX /*int*/, fromY /*int*/, toX /*int*/, toY /*int*/) {
        // Mild variant of Bresenham's algorithm
        // see http://en.wikipedia.org/wiki/Bresenham's_line_algorithm
        const steep = Math.abs(toY - fromY) > Math.abs(toX - fromX);
        if (steep) {
            let temp = fromX;
            fromX = fromY;
            fromY = temp;
            temp = toX;
            toX = toY;
            toY = temp;
        }
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        let error = -dx / 2;
        const xstep = fromX < toX ? 1 : -1;
        const ystep = fromY < toY ? 1 : -1;
        // In black pixels, looking for white, first or second time.
        let state = 0;
        // Loop up until x == toX, but not beyond
        const xLimit = toX + xstep;
        for (let x = fromX, y = fromY; x !== xLimit; x += xstep) {
            const realX = steep ? y : x;
            const realY = steep ? x : y;
            // Does current pixel mean we have moved white to black or vice versa?
            // Scanning black in state 0,2 and white in state 1, so if we find the wrong
            // color, advance to next state or end if we are in state 2 already
            if ((state === 1) === this.image.get(realX, realY)) {
                if (state === 2) {
                    return MathUtils.distance(x, y, fromX, fromY);
                }
                state++;
            }
            error += dy;
            if (error > 0) {
                if (y === toY) {
                    break;
                }
                y += ystep;
                error -= dx;
            }
        }
        // Found black-white-black; give the benefit of the doubt that the next pixel outside the image
        // is "white" so this last point at (toX+xStep,toY) is the right ending. This is really a
        // small approximation; (toX+xStep,toY+yStep) might be really correct. Ignore this.
        if (state === 2) {
            return MathUtils.distance(toX + xstep, toY, fromX, fromY);
        }
        // else we didn't find even black-white-black; no estimate is really possible
        return NaN;
    }
}
