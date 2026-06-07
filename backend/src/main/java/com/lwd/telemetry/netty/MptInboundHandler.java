package com.lwd.telemetry.netty;

import com.lwd.telemetry.mpt.MptFrame;
import com.lwd.telemetry.mpt.MptFrameDecoder;
import com.lwd.telemetry.mpt.MptFrameListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public class MptInboundHandler extends SimpleChannelInboundHandler<MptFrame> {

    private final MptFrameListener listener;

    public MptInboundHandler(MptFrameListener listener) {
        this.listener = listener;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, MptFrame frame) throws Exception {
        listener.onFrameDecoded(frame);
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) throws Exception {
        if (evt instanceof String) {
            String event = (String) evt;
            if ("SYNC_LOST".equals(event)) {
                listener.onSyncLost();
            } else if (event.startsWith("FRAME_ERROR:")) {
                String[] parts = event.split(":");
                if (parts.length >= 3) {
                    listener.onFrameError(Integer.parseInt(parts[1]), parts[2]);
                }
            }
        }
        ctx.fireUserEventTriggered(evt);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        log.error("MPT inbound handler error", cause);
        ctx.close();
    }
}
