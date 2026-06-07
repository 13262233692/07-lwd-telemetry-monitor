package com.lwd.telemetry.mpt;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageDecoder;
import lombok.extern.slf4j.Slf4j;

import java.nio.ByteOrder;
import java.util.List;
import java.util.zip.CRC32;

@Slf4j
public class MptFrameDecoder extends ByteToMessageDecoder {

    private enum DecodeState {
        SEEKING_SYNC,
        READING_HEADER,
        READING_WAVEFORM,
        READING_CRC
    }

    private DecodeState state = DecodeState.SEEKING_SYNC;
    private int syncAccumulator = 0;
    private int syncBytesMatched = 0;

    private int frameLength;
    private int frameSequence;
    private short frameType;
    private short statusCode;
    private float bitDepth;
    private float temperature;
    private float mudPressure;
    private short channelMask;
    private int sampleCount;

    private final CRC32 crc32 = new CRC32();
    private long computedCrc;

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) throws Exception {
        loop:
        while (true) {
            switch (state) {
                case SEEKING_SYNC: {
                    if (!seekSync(in)) {
                        break loop;
                    }
                    state = DecodeState.READING_HEADER;
                    crc32.reset();
                    break;
                }
                case READING_HEADER: {
                    if (in.readableBytes() < MptConstants.FRAME_HEADER_SIZE - 4) {
                        break loop;
                    }
                    if (!readHeader(in)) {
                        state = DecodeState.SEEKING_SYNC;
                        notifySyncLost(ctx);
                        break;
                    }
                    state = DecodeState.READING_WAVEFORM;
                    break;
                }
                case READING_WAVEFORM: {
                    int waveformBytes = sampleCount * MptConstants.WAVEFORM_CHANNELS * 2;
                    if (in.readableBytes() < waveformBytes) {
                        break loop;
                    }
                    float[][] waveformData = readWaveformData(in, waveformBytes);
                    state = DecodeState.READING_CRC;

                    MptFrame partialFrame = MptFrame.builder()
                            .syncWord(MptConstants.FRAME_SYNC_WORD)
                            .frameLength(frameLength)
                            .frameSequence(frameSequence)
                            .frameType(frameType)
                            .statusCode(statusCode)
                            .bitDepth(bitDepth)
                            .temperature(temperature)
                            .mudPressure(mudPressure)
                            .channelMask(channelMask)
                            .sampleCount(sampleCount)
                            .waveformData(waveformData)
                            .build();

                    ctx.channel().attr(MptAttrKeys.PARTIAL_FRAME).set(partialFrame);
                    break;
                }
                case READING_CRC: {
                    if (in.readableBytes() < 4) {
                        break loop;
                    }
                    long receivedCrc = in.readUnsignedInt();
                    computedCrc = crc32.getValue();

                    MptFrame partialFrame = ctx.channel().attr(MptAttrKeys.PARTIAL_FRAME).getAndSet(null);

                    if (computedCrc != receivedCrc) {
                        log.warn("CRC mismatch on frame seq={}, expected=0x{} actual=0x{}",
                                frameSequence, Long.toHexString(computedCrc), Long.toHexString(receivedCrc));
                        notifyFrameError(ctx, frameSequence, "CRC_MISMATCH");
                        state = DecodeState.SEEKING_SYNC;
                        break;
                    }

                    if (partialFrame != null) {
                        out.add(partialFrame);
                    }
                    state = DecodeState.SEEKING_SYNC;
                    break;
                }
            }
        }
    }

    private boolean seekSync(ByteBuf in) {
        while (in.isReadable()) {
            byte b = in.readByte();
            crc32.update(b);

            int shift = (3 - syncBytesMatched) * 8;
            syncAccumulator = (syncAccumulator & ~(0xFF << shift)) | ((b & 0xFF) << shift);

            if (syncBytesMatched < 3) {
                syncBytesMatched++;
            } else {
                if (syncAccumulator == MptConstants.FRAME_SYNC_WORD) {
                    syncBytesMatched = 0;
                    syncAccumulator = 0;
                    return true;
                } else {
                    syncAccumulator <<= 8;
                    syncAccumulator |= (b & 0xFF);
                }
            }
        }
        return false;
    }

    private boolean readHeader(ByteBuf in) {
        ByteBuf le = in.order(ByteOrder.LITTLE_ENDIAN);

        frameLength = le.readInt();
        crc32.update(le.array()[le.readerIndex() - 4], 0, 4);

        frameSequence = le.readInt();
        updateCrcFromInt(frameSequence);

        int typeStatus = le.readUnsignedShort();
        frameType = (short) ((typeStatus >> 8) & 0xFF);
        statusCode = (short) (typeStatus & 0xFF);
        updateCrcFromShort(typeStatus);

        bitDepth = Float.intBitsToFloat(le.readInt());
        updateCrcFromInt(Float.floatToRawIntBits(bitDepth));

        temperature = Float.intBitsToFloat(le.readInt());
        updateCrcFromInt(Float.floatToRawIntBits(temperature));

        mudPressure = Float.intBitsToFloat(le.readInt());
        updateCrcFromInt(Float.floatToRawIntBits(mudPressure));

        int maskSample = le.readUnsignedShort();
        channelMask = (short) ((maskSample >> 12) & 0x0F);
        sampleCount = maskSample & 0x0FFF;
        updateCrcFromShort(maskSample);

        if (sampleCount <= 0 || sampleCount > MptConstants.WAVEFORM_SAMPLES_PER_FRAME) {
            log.error("Invalid sample count: {}, max allowed: {}", sampleCount,
                    MptConstants.WAVEFORM_SAMPLES_PER_FRAME);
            return false;
        }

        if (frameLength < MptConstants.FRAME_HEADER_SIZE + 4 ||
                frameLength > MptConstants.FRAME_TOTAL_SIZE) {
            log.error("Invalid frame length: {}", frameLength);
            return false;
        }

        return true;
    }

    private float[][] readWaveformData(ByteBuf in, int totalBytes) {
        float[][] data = new float[MptConstants.WAVEFORM_CHANNELS][sampleCount];
        ByteBuf le = in.order(ByteOrder.LITTLE_ENDIAN);

        for (int ch = 0; ch < MptConstants.WAVEFORM_CHANNELS; ch++) {
            if ((channelMask & (1 << ch)) == 0) {
                continue;
            }
            for (int s = 0; s < sampleCount; s++) {
                short raw = le.readShort();
                data[ch][s] = raw / 32768.0f;
            }
        }

        byte[] waveformBytes = new byte[totalBytes];
        in.getBytes(in.readerIndex() - totalBytes, waveformBytes, 0, totalBytes);
        crc32.update(waveformBytes, 0, totalBytes);

        return data;
    }

    private void updateCrcFromInt(int value) {
        crc32.update((value) & 0xFF);
        crc32.update((value >> 8) & 0xFF);
        crc32.update((value >> 16) & 0xFF);
        crc32.update((value >> 24) & 0xFF);
    }

    private void updateCrcFromShort(int value) {
        crc32.update((value) & 0xFF);
        crc32.update((value >> 8) & 0xFF);
    }

    private void notifySyncLost(ChannelHandlerContext ctx) {
        ctx.fireUserEventTriggered("SYNC_LOST");
    }

    private void notifyFrameError(ChannelHandlerContext ctx, int seq, String error) {
        ctx.fireUserEventTriggered("FRAME_ERROR:" + seq + ":" + error);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        log.error("MPT decoder error", cause);
        state = DecodeState.SEEKING_SYNC;
        syncBytesMatched = 0;
        syncAccumulator = 0;
        ctx.close();
    }
}
